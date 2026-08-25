"""
Bloomberg TCA Bridge
====================
A local FastAPI server that wraps blpapi for the TCA SPA.

Setup
-----
    pip install fastapi uvicorn blpapi
    python bridge.py
    # Runs on http://localhost:8000

The SPA polls /health to detect whether the bridge is running.
All other endpoints are called on demand (never on startup).

Session lifecycle: one blpapi session per request (simpler; adds ~1-2 s per
call). For datasets > 100 trades, consider refactoring to a persistent session:
replace `create_session()` / `session.stop()` with a module-level singleton.
"""

from __future__ import annotations

import base64
import logging
import logging.handlers
import math
import pathlib
import re
import time
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── blpapi import (graceful degradation when SDK not installed) ───────────────
try:
    import blpapi
    BLPAPI_AVAILABLE = True
except ImportError:
    blpapi = None  # type: ignore[assignment]
    BLPAPI_AVAILABLE = False

# ── Logging ───────────────────────────────────────────────────────────────────
# Everything printed to the console is also written to bridge.log next to this
# file.  The launcher used to redirect the process's stdout to that file, which
# left the console window blank; letting the bridge own its logging means the
# heartbeat and per-request lines stay visible AND a crash after the window is
# closed is still diagnosable.

LOG_PATH = pathlib.Path(__file__).parent / "bridge.log"

log = logging.getLogger("bridge")


def _configure_logging() -> None:
    """Attach a console and a rotating-file handler to the bridge + uvicorn logs."""
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    console = logging.StreamHandler()
    console.setFormatter(fmt)

    handlers: list[logging.Handler] = [console]
    try:
        # 1 MB x 3 so an all-day session cannot fill the disk
        rotating = logging.handlers.RotatingFileHandler(
            LOG_PATH, maxBytes=1_000_000, backupCount=3, encoding="utf-8",
        )
        rotating.setFormatter(fmt)
        handlers.append(rotating)
    except OSError:
        # Read-only folder or a locked file: console-only is still useful
        pass

    for name in ("bridge", "uvicorn", "uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.setLevel(logging.INFO)
        logger.handlers = list(handlers)
        # uvicorn installs its own handlers; don't also bubble up to the root
        logger.propagate = False


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Bloomberg TCA Bridge", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # SPA runs on file:// or localhost in dev
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Yellow-key inference ──────────────────────────────────────────────────────
# Maps futures contract root → Bloomberg yellow key.
# Add entries as needed; unknown roots fall back to "Index".
YELLOW_KEY: dict[str, str] = {
    # Equity index futures
    "ES": "Index", "NQ": "Index", "RTY": "Index", "YM": "Index",
    "VX": "Index", "EMD": "Index", "NK": "Index", "Z": "Index",
    "FDAX": "Index", "FESX": "Index", "DX": "Index",
    # Energy
    "CL": "Comdty", "NG": "Comdty", "HO": "Comdty", "RB": "Comdty",
    "BZ": "Comdty", "XB": "Comdty", "QM": "Comdty",
    # Metals
    "GC": "Comdty", "SI": "Comdty", "HG": "Comdty", "PL": "Comdty",
    "PA": "Comdty",
    # Agriculture
    "ZW": "Comdty", "ZC": "Comdty", "ZS": "Comdty", "ZL": "Comdty",
    "ZM": "Comdty", "CT": "Comdty", "KC": "Comdty", "SB": "Comdty",
    "CC": "Comdty", "OJ": "Comdty",
    # Rates / Fixed Income
    "ZN": "Comdty", "ZB": "Comdty", "ZF": "Comdty", "ZT": "Comdty",
    "UB": "Comdty", "TN": "Comdty", "SR3": "Comdty",
    # FX futures
    "6E": "Crncy", "6J": "Crncy", "6B": "Crncy", "6C": "Crncy",
    "6A": "Crncy", "6S": "Crncy", "6N": "Crncy", "6M": "Crncy",
    "6R": "Crncy", "6Z": "Crncy",
}

# Month codes used in futures tickers (Jan–Dec)
_MONTH_CODES = set("FGHJKMNQUVXZ")
_ROOT_RE = re.compile(r"^([A-Z0-9]+?)[FGHJKMNQUVXZ]\d{1,2}$")


def extract_root(symbol: str) -> str:
    """Strip month code and year to get the contract root, e.g. 'ESH4' → 'ES'."""
    m = _ROOT_RE.match(symbol.upper().strip())
    return m.group(1) if m else symbol.upper().strip()


def resolve_ticker(symbol: str) -> str:
    """
    Return the full Bloomberg ticker string, e.g. 'ESH4' → 'ESH4 Index'.

    If the symbol already contains a space it is already a complete Bloomberg
    security string (e.g. 'FVU6 Comdty' from the RIC→Bloomberg mapping table).
    In that case the string is returned uppercased without appending another
    yellow key — previously this produced invalid identifiers like
    'FVU6 COMDTY INDEX'.
    """
    s = symbol.strip()
    if " " in s:
        # Already fully qualified — just normalise case
        return s.upper()
    root = extract_root(s)
    key = YELLOW_KEY.get(root, "Index")
    return f"{s.upper()} {key}"


# ── DateTime helpers ──────────────────────────────────────────────────────────

def parse_dt(s: str) -> datetime:
    """
    Parse a datetime string from the SPA query params.
    Accepts ISO-8601 ('2024-03-15T09:30:00Z') or FIX format ('20240315-09:30:00').
    """
    s = s.strip()
    if len(s) >= 8 and s[8] == "-" and "T" not in s:
        # FIX format: YYYYMMDD-HH:mm:ss[.SSS]
        fmt = "%Y%m%d-%H:%M:%S.%f" if "." in s else "%Y%m%d-%H:%M:%S"
        return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
    # ISO 8601
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def to_blp_dt(dt: datetime) -> datetime:
    """
    Return a UTC-aware datetime for blpapi request.set().

    Preserving tzinfo=UTC is critical: without it, blpapi sends a naive
    datetime which Bloomberg interprets as *exchange local time* rather than
    UTC.  For a CME contract (CDT = UTC-5) this shifts the window by 5 hours
    — bars for the overnight session are returned instead of the afternoon
    execution window, breaking TWAP and intraday-vol calculations.

    Modern blpapi Python SDK (≥ 3.16) accepts timezone-aware datetimes.
    If an older SDK raises on tzinfo, strip it as a last resort:
      return dt.astimezone(timezone.utc).replace(tzinfo=None)
    """
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc)
    return dt.replace(tzinfo=timezone.utc)


def blp_dt_to_iso(value: Any) -> str:
    """Convert a blpapi Datetime (or Python datetime) to an ISO string."""
    if isinstance(value, datetime):
        return value.isoformat()
    # blpapi.Datetime has year/month/day/hour/minute/second attributes
    try:
        dt = datetime(
            value.year, value.month, value.day,
            value.hour, value.minute, value.second,
        )
        return dt.isoformat()
    except Exception:
        return str(value)


# ── Timestamp UTC normalisation ──────────────────────────────────────────────

# Bloomberg may return an item slightly *before* the requested start (bars are
# aligned to minute boundaries).  Allow that much slack before the floor below
# concludes the exchange offset is a whole hour smaller.
_OFFSET_TOLERANCE_S = 120


def _infer_offset_hours(
    items: list[dict[str, Any]],
    request_start_utc: datetime,
) -> tuple[int, float] | None:
    """
    Infer the exchange→UTC offset (whole hours) from the first item's naive
    timestamp, together with the residual: how far that item sat past the
    request start once shifted.

    Returns (offset_hours, residual_secs), or None when it cannot be inferred.

    Uses floor rather than rounding.  Bloomberg never returns data before the
    requested start, so the shifted first item must land at or after it, giving
    a residual in [0, 1 h).  Rounding instead added a spurious hour whenever the
    first quote arrived more than 30 minutes into the window — routine on an
    illiquid instrument such as a futures calendar spread, whose quotes can sit
    unchanged for long stretches.
    """
    if not items:
        return None
    try:
        # Strip tzinfo for naive arithmetic; round to minute boundary
        ref = request_start_utc.replace(tzinfo=None, second=0, microsecond=0)
        first_naive = datetime.fromisoformat(items[0]["time"])
        diff_secs = (first_naive - ref).total_seconds()
        offset_hours = math.floor((diff_secs + _OFFSET_TOLERANCE_S) / 3_600)
        if abs(offset_hours) > 14:
            return None  # Implausible — caller stamps Z without shifting
        return offset_hours, diff_secs - offset_hours * 3_600
    except Exception:
        return None


def _normalize_to_utc(
    items: list[dict[str, Any]],
    request_start_utc: datetime,
    offset_hours: int | None = None,
) -> list[dict[str, Any]]:
    """
    Shift bar/tick timestamps from exchange-local time to UTC and append 'Z'.

    Bloomberg always returns intraday timestamps in the exchange's local
    timezone as naive ISO strings (no offset), regardless of whether the
    request datetimes carried a UTC offset.  This means a CME bar at
    14:40 CDT arrives as "2026-05-28T14:40:00", but the SPA expects UTC.

    The offset is inferred by _infer_offset_hours() unless the caller supplies
    one.  Callers that stitch several requests together (see /bid-ask-ticks)
    pass a single shared offset so every chunk lands on the same timeline.

    Example (CDT = UTC-5, request start 19:40 UTC):
      First bar  : "2026-05-28T14:40:00" (14:40 CDT)
      Naive UTC  : 2026-05-28T19:40:00
      Offset     : 14:40 - 19:40 = -5 h  →  shift = +5 h
      Result     : "2026-05-28T19:40:00Z"
    """
    if not items:
        return items

    if offset_hours is None:
        inferred = _infer_offset_hours(items, request_start_utc)
        if inferred is None:
            # Can't work out the offset — don't corrupt data; just stamp Z as-is
            return [{**item, "time": item["time"] + "Z"} for item in items]
        offset_hours = inferred[0]

    try:
        shift = timedelta(hours=-offset_hours)
        return [
            {
                **item,
                "time": (datetime.fromisoformat(item["time"]) + shift).isoformat() + "Z",
            }
            for item in items
        ]
    except Exception:
        return items


# ── blpapi session helpers ────────────────────────────────────────────────────

def _require_blpapi():
    if not BLPAPI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="blpapi SDK is not installed. Run: pip install blpapi",
        )


def _create_session():
    """Start a new blpapi session connected to the local Bloomberg terminal."""
    options = blpapi.SessionOptions()
    options.setServerHost("localhost")
    options.setServerPort(8194)
    session = blpapi.Session(options)
    if not session.start():
        raise HTTPException(status_code=503, detail="Failed to start Bloomberg session")
    if not session.openService("//blp/refdata"):
        session.stop()
        raise HTTPException(status_code=503, detail="Failed to open //blp/refdata service")
    return session


def _drain(session, timeout_ms: int = 15_000) -> list:
    """
    Collect response messages from a Bloomberg session.

    Only appends messages from PARTIAL_RESPONSE and RESPONSE events.
    SESSION_STATUS, SERVICE_STATUS, ADMIN, and other housekeeping event
    types are silently ignored — if they were collected, downstream code
    would crash trying to call .hasElement("securityData") on them.

    Raises HTTPException 502 if Bloomberg explicitly rejects the request
    (REQUEST_STATUS event).
    Raises HTTPException 504 if no RESPONSE arrives before the deadline.
    """
    messages = []
    deadline = time.monotonic() + timeout_ms / 1_000

    while time.monotonic() < deadline:
        remaining_ms = max(100, int((deadline - time.monotonic()) * 1_000))
        event = session.nextEvent(remaining_ms)
        event_type = event.eventType()

        if event_type in (blpapi.Event.PARTIAL_RESPONSE, blpapi.Event.RESPONSE):
            for msg in event:
                messages.append(msg)
            if event_type == blpapi.Event.RESPONSE:
                return messages

        elif event_type == blpapi.Event.REQUEST_STATUS:
            # Bloomberg explicitly rejected the request — extract the reason
            for msg in event:
                try:
                    reason = msg.getElement("reason")
                    desc = reason.getElement("description").getValueAsString()
                    raise HTTPException(
                        status_code=502,
                        detail=f"Bloomberg request failed: {desc}",
                    )
                except HTTPException:
                    raise
                except Exception:
                    pass
            raise HTTPException(
                status_code=502,
                detail="Bloomberg request failed (unknown reason)",
            )

        # Ignore SESSION_STATUS, SERVICE_STATUS, ADMIN, TIMEOUT, etc.

    raise HTTPException(
        status_code=504,
        detail=f"Bloomberg request timed out after {timeout_ms // 1_000} seconds",
    )


# ── blpapi request helpers ────────────────────────────────────────────────────

def _get_reference_data(ticker: str, fields: list[str]) -> dict[str, Any]:
    """
    ReferenceDataRequest for a single security.

    Handles Bloomberg field errors gracefully: if a field is not valid for
    the security type (e.g. HIST_VOL_30D on some fixed-income futures),
    it is omitted from the result rather than raising an exception.
    """
    session = _create_session()
    try:
        svc = session.getService("//blp/refdata")
        req = svc.createRequest("ReferenceDataRequest")
        req.append("securities", ticker)
        for f in fields:
            req.append("fields", f)
        session.sendRequest(req)

        result: dict[str, Any] = {}
        for msg in _drain(session):
            if not msg.hasElement("securityData"):
                continue
            sec_arr = msg.getElement("securityData")
            for i in range(sec_arr.numValues()):
                sec = sec_arr.getValueAsElement(i)

                # Security-level error (bad ticker, etc.) — skip
                if sec.hasElement("securityError"):
                    err_msg = sec.getElement("securityError").getElementAsString("message")
                    log.warning("Bloomberg security error for %s: %s", ticker, err_msg)
                    continue

                # Valid field values live in fieldData
                if sec.hasElement("fieldData"):
                    fld_data = sec.getElement("fieldData")
                    for j in range(fld_data.numElements()):
                        el = fld_data.getElement(j)
                        try:
                            result[str(el.name())] = el.getValue()
                        except Exception:
                            pass

                # Invalid fields return fieldExceptions — skip gracefully.
                # These are expected for fields not available on a given security
                # type (e.g. HIST_VOL_30D on fixed-income futures); the SPA falls
                # back to alternative fields or bar-derived vol automatically.
                if sec.hasElement("fieldExceptions"):
                    exc_arr = sec.getElement("fieldExceptions")
                    for k in range(exc_arr.numValues()):
                        exc = exc_arr.getValueAsElement(k)
                        try:
                            fid = exc.getElement("fieldId").getValueAsString()
                            log.info("Field not available for %s: %s (handled by fallback)", ticker, fid)
                        except Exception:
                            pass

        return result
    finally:
        session.stop()


def _get_intraday_bars(
    ticker: str,
    start: datetime,
    end: datetime,
    interval: int,
) -> list[dict[str, Any]]:
    """IntradayBarRequest (TRADE events) for a security over a time range."""
    session = _create_session()
    try:
        svc = session.getService("//blp/refdata")
        req = svc.createRequest("IntradayBarRequest")
        req.set("security", ticker)
        req.set("eventType", "TRADE")
        req.set("startDateTime", to_blp_dt(start))
        req.set("endDateTime", to_blp_dt(end))
        req.set("interval", interval)
        session.sendRequest(req)

        bars = []
        for msg in _drain(session):
            if not msg.hasElement("barData"):
                continue
            bar_tick_data = msg.getElement("barData").getElement("barTickData")
            for i in range(bar_tick_data.numValues()):
                bar = bar_tick_data.getValueAsElement(i)
                try:
                    bars.append({
                        "time": blp_dt_to_iso(bar.getElement("time").getValue()),
                        "open": float(bar.getElement("open").getValue()),
                        "high": float(bar.getElement("high").getValue()),
                        "low": float(bar.getElement("low").getValue()),
                        "close": float(bar.getElement("close").getValue()),
                        "volume": int(bar.getElement("volume").getValue()),
                        "numEvents": int(bar.getElement("numEvents").getValue()),
                    })
                except Exception:
                    pass
        # Shift exchange-local timestamps → UTC so the SPA can filter correctly
        return _normalize_to_utc(bars, start)
    finally:
        session.stop()


def _get_intraday_ticks(
    ticker: str,
    start: datetime,
    end: datetime,
    event_types: list[str],
    timeout_ms: int = 15_000,
    normalize: bool = True,
) -> list[dict[str, Any]]:
    """
    IntradayTickRequest for specific event types.

    Pass normalize=False to get the raw exchange-local timestamps back.  Callers
    that issue several requests for one logical window use that to apply a single
    shared UTC offset across every chunk (see /bid-ask-ticks).
    """
    session = _create_session()
    try:
        svc = session.getService("//blp/refdata")
        req = svc.createRequest("IntradayTickRequest")
        req.set("security", ticker)
        for et in event_types:
            req.getElement("eventTypes").appendValue(et)
        req.set("startDateTime", to_blp_dt(start))
        req.set("endDateTime", to_blp_dt(end))
        req.set("includeConditionCodes", False)
        session.sendRequest(req)

        raw_ticks = []
        for msg in _drain(session, timeout_ms=timeout_ms):
            if not msg.hasElement("tickData"):
                continue
            tick_array = msg.getElement("tickData").getElement("tickData")
            for i in range(tick_array.numValues()):
                tick = tick_array.getValueAsElement(i)
                try:
                    raw_ticks.append({
                        "time": blp_dt_to_iso(tick.getElement("time").getValue()),
                        "type": tick.getElement("type").getValueAsString(),
                        "value": float(tick.getElement("value").getValue()),
                    })
                except Exception:
                    pass
        # Shift exchange-local timestamps → UTC
        return _normalize_to_utc(raw_ticks, start) if normalize else raw_ticks
    finally:
        session.stop()


def _get_trade_ticks(
    ticker: str,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    """IntradayTickRequest for TRADE events, capturing last price and size."""
    session = _create_session()
    try:
        svc = session.getService("//blp/refdata")
        req = svc.createRequest("IntradayTickRequest")
        req.set("security", ticker)
        req.getElement("eventTypes").appendValue("TRADE")
        req.set("startDateTime", to_blp_dt(start))
        req.set("endDateTime", to_blp_dt(end))
        req.set("includeConditionCodes", False)
        session.sendRequest(req)

        raw_ticks = []
        for msg in _drain(session):
            if not msg.hasElement("tickData"):
                continue
            tick_array = msg.getElement("tickData").getElement("tickData")
            for i in range(tick_array.numValues()):
                tick = tick_array.getValueAsElement(i)
                try:
                    raw_ticks.append({
                        "time": blp_dt_to_iso(tick.getElement("time").getValue()),
                        "price": float(tick.getElement("value").getValue()),
                        "size": int(tick.getElement("size").getValue()),
                    })
                except Exception:
                    pass
        return _normalize_to_utc(raw_ticks, start)
    finally:
        session.stop()


def _reconstruct_bid_ask_pairs(
    raw_ticks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Convert a stream of individual BID/ASK ticks to paired quotes.

    A pair is emitted only when the prevailing quote actually *changes*.
    Bloomberg repeats a BID or ASK tick on every refresh even when the price is
    unchanged, which on a quiet instrument inflates an hour of data into
    thousands of identical pairs.  Dropping the repeats is lossless for TWAS:
    consumers weight each pair until the next one, so a removed duplicate is
    absorbed into its predecessor's Δt.
    """
    current_bid: float | None = None
    current_ask: float | None = None
    last_emitted: tuple[float, float] | None = None
    pairs = []

    for tick in sorted(raw_ticks, key=lambda t: t["time"]):
        t_type = tick.get("type", "").upper()
        if t_type == "BID":
            current_bid = tick["value"]
        elif t_type == "ASK":
            current_ask = tick["value"]
        else:
            continue

        if current_bid is None or current_ask is None:
            continue

        quote = (current_bid, current_ask)
        if quote == last_emitted:
            continue
        last_emitted = quote

        pairs.append({
            "time": tick["time"],
            "bid": current_bid,
            "ask": current_ask,
        })

    return pairs


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """SPA polls this endpoint for the status badge."""
    return {
        "status": "ok",
        "blpapi": BLPAPI_AVAILABLE,
    }


@app.get("/snapshot")
def snapshot(security: str, dt: str):
    """
    Arrival price at a specific datetime.

    Strategy:
    - Fetch BID and ASK ticks in the 5-minute window ending at dt.
    - Return the mid of the last bid/ask pair at or before dt.
    - If no ticks, fall back to the open of the 1-minute bar containing dt.

    Query params:
      security  bare ticker, e.g. 'ESH4'
      dt        ISO-8601 or FIX datetime string
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    target = parse_dt(dt)

    # Window: 5 min before dt to 30 sec after
    start = target - timedelta(minutes=5)
    end = target + timedelta(seconds=30)

    # Try tick-level mid first
    try:
        raw = _get_intraday_ticks(ticker, start, end, ["BID", "ASK"])
        pairs = _reconstruct_bid_ask_pairs(raw)
        # Find last pair at or before target
        target_iso = target.isoformat()
        best = None
        for p in pairs:
            if p["time"] <= target_iso:
                best = p
        if best:
            return {"arrivalPrice": round((best["bid"] + best["ask"]) / 2, 6)}
    except Exception:
        pass

    # Fall back to 1-minute bar open
    try:
        bars = _get_intraday_bars(ticker, start, end, 1)
        target_iso = target.isoformat()
        for bar in bars:
            bar_end_iso = (
                datetime.fromisoformat(bar["time"])
                .replace(second=0, microsecond=0)
            )
            # bar covers [bar_time, bar_time + 1 min)
            if bar["time"] <= target_iso:
                last_bar = bar
        if "last_bar" in dir():
            return {"arrivalPrice": last_bar["open"]}  # type: ignore[name-defined]
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"No price data for {ticker} at {dt}")


@app.get("/intraday-bars")
def intraday_bars(
    security: str,
    start: str,
    end: str,
    interval: int = 1,
):
    """
    VWAP, daily vol, and reversion mark data.

    Returns 1-minute (or coarser) OHLCV bars for a security over [start, end].
    The SPA fetches from orderTime-5min to EOD in a single call to cover
    all enrichment needs in one request.

    Query params:
      security  bare ticker, e.g. 'ESH4'
      start     ISO-8601 or FIX datetime
      end       ISO-8601 or FIX datetime
      interval  bar size in minutes (default 1)
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    return _get_intraday_bars(ticker, parse_dt(start), parse_dt(end), interval)


@app.get("/reference")
def reference(security: str, fields: str = "HIST_VOL_30D,VOLUME_AVG_30D,FUT_CONT_SIZE,CRNCY"):
    """
    Contract reference data.

    Default fields: HIST_VOL_30D (annualized vol %), VOLUME_AVG_30D (contracts),
    FUT_CONT_SIZE (point value), CRNCY.

    Query params:
      security  bare ticker, e.g. 'ESH4'
      fields    comma-separated Bloomberg field names
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    field_list = [f.strip() for f in fields.split(",") if f.strip()]
    return _get_reference_data(ticker, field_list)


def _infer_min_tick(bars: list[dict[str, Any]]) -> float | None:
    """
    Smallest non-zero price increment observed across the bars' OHLC values.

    A crude but reliable read on the instrument's tick size, used to floor the
    synthetic spread below.  Returns None when the bars carry fewer than two
    distinct prices.
    """
    prices: set[float] = set()
    for bar in bars:
        for key in ("open", "high", "low", "close"):
            try:
                prices.add(round(float(bar[key]), 10))
            except Exception:
                pass

    ordered = sorted(prices)
    min_tick: float | None = None
    for lower, upper in zip(ordered, ordered[1:]):
        diff = upper - lower
        if diff > 1e-9 and (min_tick is None or diff < min_tick):
            min_tick = diff
    return min_tick


def _estimate_spread_from_bars(bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Construct synthetic bid/ask pairs from 1-minute OHLC bars.

    Last-resort fallback for when no BID/ASK ticks are available at all.  The
    width is 50 % of the bar's high-low range, centred on the bar's close, and
    floored at one tick.

    The floor matters: the high-low range measures intra-bar *movement*, not
    spread, so a market that trades at a single price for the whole minute
    yields a range of zero and would otherwise be reported as having no spread.
    That is exactly what happens on a pinned futures calendar spread, where most
    minutes print at one price and the real market is still a tick wide.

    This remains a rough proxy — the endpoint labels it "bars" so the SPA can
    caveat it — and is never a substitute for real quote data.
    """
    min_tick = _infer_min_tick(bars)
    pairs = []
    for bar in bars:
        try:
            bar_range = float(bar["high"]) - float(bar["low"])
            width = bar_range * 0.5
            if min_tick is not None:
                width = max(width, min_tick)
            half_spread = width / 2
            mid = float(bar["close"])
            pairs.append({
                "time": bar["time"],
                # 10 dp, not fewer: Treasury spreads live on a 1/256 grid, and
                # rounding bid and ask independently at 8 dp shaved the width off
                # the tick boundary (0.00390624 instead of 1/256 = 0.00390625).
                "bid": round(mid - half_spread, 10),
                "ask": round(mid + half_spread, 10),
            })
        except Exception:
            pass
    return pairs


# Tick requests are split into chunks of this many minutes.  Bloomberg's
# IntradayTickRequest slows sharply with window size, and a single multi-hour
# request routinely blew past the drain deadline; several small ones do not.
_TICK_CHUNK_MINUTES = 45

# Ceiling on chunks per request (~12 h) so a bad start/end can't fan out.
_MAX_TICK_CHUNKS = 16


@app.get("/bid-ask-ticks")
def bid_ask_ticks(security: str, start: str, end: str):
    """
    Bid/ask tick stream for TWAS calculation (and arrival price mid-point).

    Returns {"source": "ticks" | "bars" | "none", "pairs": [{time, bid, ask}]}.
    Each pair reflects the prevailing best bid and ask after a quote change.

    The window is split into 45-minute chunks and fetched with real BID/ASK
    ticks, chunk by chunk, so a long parent order still gets true quote data —
    previously anything over 60 minutes skipped ticks entirely in favour of a
    spread estimated from bar ranges, which reports ~0 spread on any instrument
    that trades at one price for most of each minute.

    "source" tells the SPA which path produced the pairs so it can caveat the
    bar-based estimate in the TWAS tooltip.

    Query params:
      security  bare ticker, e.g. 'ESH4'
      start     ISO-8601 or FIX datetime
      end       ISO-8601 or FIX datetime
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    start_dt = parse_dt(start)
    end_dt   = parse_dt(end)

    # ── Real BID/ASK ticks, fetched in chunks ────────────────────────────────
    chunks: list[tuple[datetime, datetime]] = []
    cursor = start_dt
    while cursor < end_dt and len(chunks) < _MAX_TICK_CHUNKS:
        chunk_end = min(cursor + timedelta(minutes=_TICK_CHUNK_MINUTES), end_dt)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end

    raw_ticks: list[dict[str, Any]] = []
    # Best (smallest-residual) offset seen, as (residual_secs, offset_hours).
    # The chunk whose first tick arrives soonest after its own start gives the
    # most trustworthy read on the exchange offset; that one offset is then
    # applied to every chunk so the merged stream shares a single timeline.
    best_offset: tuple[float, int] | None = None

    for chunk_start, chunk_end in chunks:
        try:
            chunk_raw = _get_intraday_ticks(
                ticker, chunk_start, chunk_end, ["BID", "ASK"],
                timeout_ms=45_000, normalize=False,
            )
        except HTTPException:
            break  # Bloomberg timed out or rejected — keep the chunks we have

        if not chunk_raw:
            continue

        inferred = _infer_offset_hours(chunk_raw, chunk_start)
        if inferred is not None:
            offset_hours, residual = inferred
            if best_offset is None or residual < best_offset[0]:
                best_offset = (residual, offset_hours)

        raw_ticks.extend(chunk_raw)

    if raw_ticks:
        normalized = _normalize_to_utc(
            raw_ticks, start_dt,
            offset_hours=best_offset[1] if best_offset is not None else None,
        )
        tick_pairs = _reconstruct_bid_ask_pairs(normalized)
        if tick_pairs:
            return {"source": "ticks", "pairs": tick_pairs}

    # ── Fallback: spread estimated from 1-minute bar ranges ──────────────────
    try:
        bars = _get_intraday_bars(ticker, start_dt, end_dt, 1)
        estimated = _estimate_spread_from_bars(bars)
        if estimated:
            return {"source": "bars", "pairs": estimated}
    except Exception:
        pass

    # Nothing worked — the SPA falls back to N/A gracefully.
    return {"source": "none", "pairs": []}


@app.get("/trade-ticks")
def trade_ticks(security: str, start: str, end: str):
    """
    Last-traded price and size tick stream for running market VWAP.

    Returns {time, price, size}[] for all TRADE events in [start, end].
    Used for true VWAP (Σ price×size / Σ size) on short orders (≤ 5 minutes).

    Query params:
      security  bare ticker, e.g. 'ESH4'
      start     ISO-8601 or FIX datetime
      end       ISO-8601 or FIX datetime
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    return _get_trade_ticks(ticker, parse_dt(start), parse_dt(end))


# ── Branding endpoints ────────────────────────────────────────────────────────
# Reads controlled branding assets from branding.zip (same directory as this
# file). Privileged users update the zip; regular users get the assets
# automatically on the next bridge restart.

_BRANDING_ZIP = pathlib.Path(__file__).parent / "branding.zip"


def _read_branding_file(filename: str) -> bytes:
    """Read a file from branding.zip; raise HTTPException if missing."""
    if not _BRANDING_ZIP.exists():
        raise HTTPException(status_code=404, detail="branding.zip not found")
    try:
        with zipfile.ZipFile(_BRANDING_ZIP) as zf:
            return zf.read(filename)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"{filename} not found in branding.zip")


@app.get("/branding/logo")
def branding_logo():
    """Return the company logo as a base64 data-URL (PNG expected)."""
    data = _read_branding_file("logo.png")
    data_url = "data:image/png;base64," + base64.b64encode(data).decode()
    return {"dataUrl": data_url}


@app.get("/branding/disclaimer")
def branding_disclaimer():
    """Return the legal disclaimer text from disclaimer.txt."""
    data = _read_branding_file("disclaimer.txt")
    return {"text": data.decode("utf-8")}


@app.get("/branding/title")
def branding_title():
    """Return the report title from title.txt."""
    data = _read_branding_file("title.txt")
    return {"text": data.decode("utf-8").strip()}


@app.get("/branding/sym-mapping")
def branding_sym_mapping():
    """Return sym_mapping.csv as raw text for the SPA to parse and merge."""
    data = _read_branding_file("sym_mapping.csv")
    return {"csv": data.decode("utf-8")}


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    _configure_logging()

    log.info("Bloomberg TCA Bridge starting on http://127.0.0.1:8000")
    if BLPAPI_AVAILABLE:
        log.info("Bloomberg SDK (blpapi) loaded - market data available")
    else:
        log.warning(
            "Bloomberg SDK (blpapi) NOT installed - the app will run, "
            "but every market-data request will fail"
        )
    log.info("Logging to %s", LOG_PATH)
    log.info("Leave this window open. Press Ctrl+C to stop.")

    # log_config=None keeps the handlers installed above; uvicorn would
    # otherwise replace them and the file handler would stop receiving lines.
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info", log_config=None)
