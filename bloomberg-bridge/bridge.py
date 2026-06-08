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

def _normalize_to_utc(
    items: list[dict[str, Any]],
    request_start_utc: datetime,
) -> list[dict[str, Any]]:
    """
    Shift bar/tick timestamps from exchange-local time to UTC and append 'Z'.

    Bloomberg always returns intraday timestamps in the exchange's local
    timezone as naive ISO strings (no offset), regardless of whether the
    request datetimes carried a UTC offset.  This means a CME bar at
    14:40 CDT arrives as "2026-05-28T14:40:00", but the SPA expects UTC.

    We detect the shift by comparing the first item's naive time against
    the known UTC request start.  The difference, rounded to the nearest
    hour, is the exchange→UTC offset; we correct every timestamp and
    append 'Z' so the SPA's `new Date()` calls produce correct UTC epochs.

    Example (CDT = UTC-5, request start 19:40 UTC):
      First bar  : "2026-05-28T14:40:00" (14:40 CDT)
      Naive UTC  : 2026-05-28T19:40:00
      Offset     : 14:40 - 19:40 = -5 h  →  shift = +5 h
      Result     : "2026-05-28T19:40:00Z"
    """
    if not items:
        return items
    try:
        # Strip tzinfo for naive arithmetic; round to minute boundary
        ref = request_start_utc.replace(tzinfo=None, second=0, microsecond=0)
        first_naive = datetime.fromisoformat(items[0]["time"])
        diff_secs = (first_naive - ref).total_seconds()
        offset_hours = round(diff_secs / 3_600)

        if abs(offset_hours) > 14:
            # Implausible — don't corrupt data; just stamp Z as-is
            return [
                {**item, "time": item["time"] + "Z"}
                for item in items
            ]

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
                    print(f"[WARN] Bloomberg security error for {ticker}: {err_msg}")
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
                            print(f"[INFO] Field not available for {ticker}: {fid} (handled by fallback)")
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
) -> list[dict[str, Any]]:
    """IntradayTickRequest for specific event types."""
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
        return _normalize_to_utc(raw_ticks, start)
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
    Each time either side updates, a new (bid, ask, time) pair is emitted.
    """
    current_bid: float | None = None
    current_ask: float | None = None
    pairs = []

    for tick in sorted(raw_ticks, key=lambda t: t["time"]):
        t_type = tick.get("type", "").upper()
        if t_type == "BID":
            current_bid = tick["value"]
        elif t_type == "ASK":
            current_ask = tick["value"]
        else:
            continue

        if current_bid is not None and current_ask is not None:
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


def _estimate_spread_from_bars(bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Construct synthetic bid/ask pairs from 1-minute OHLC bars.

    Used as a fallback when tick-level data times out (e.g. orders > 90 min).
    Spread is estimated as 25 % of the bar's high-low range, centred on the
    bar's close price.  This is a rough proxy — sufficient for TWAS context
    but not a substitute for real tick data on short orders.
    """
    pairs = []
    for bar in bars:
        try:
            bar_range = float(bar["high"]) - float(bar["low"])
            half_spread = bar_range * 0.25
            mid = float(bar["close"])
            pairs.append({
                "time": bar["time"],
                "bid": round(mid - half_spread, 6),
                "ask": round(mid + half_spread, 6),
            })
        except Exception:
            pass
    return pairs


@app.get("/bid-ask-ticks")
def bid_ask_ticks(security: str, start: str, end: str):
    """
    Bid/ask tick stream for TWAS calculation (and arrival price mid-point).

    Returns a chronological list of paired {time, bid, ask} quotes.
    Each entry reflects the prevailing best bid and ask after a quote update.

    For orders ≤ 90 minutes: fetches real BID/ASK ticks with a 60-second
    timeout (up from the default 15 s used by other endpoints).
    For orders > 90 minutes, or when ticks time out: falls back to synthetic
    bid/ask pairs estimated from 1-minute OHLC bars (25 % of the bar range
    centred on close).  The bar-based estimate is labelled in the response so
    the SPA can show an appropriate caveat in the TWAS tooltip.

    Query params:
      security  bare ticker, e.g. 'ESH4'
      start     ISO-8601 or FIX datetime
      end       ISO-8601 or FIX datetime
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    start_dt = parse_dt(start)
    end_dt   = parse_dt(end)
    window_minutes = (end_dt - start_dt).total_seconds() / 60

    # For windows ≤ 60 min, try real BID/ASK ticks with a 45-second timeout.
    # Longer windows produce too many ticks to transfer reliably; skip straight
    # to bar-based estimation so the response stays fast.
    if window_minutes <= 60:
        try:
            raw = _get_intraday_ticks(ticker, start_dt, end_dt, ["BID", "ASK"], timeout_ms=45_000)
            tick_pairs = _reconstruct_bid_ask_pairs(raw)
            if tick_pairs:
                return tick_pairs
        except HTTPException:
            pass  # Fall through to bar estimation

    # Bar-based spread estimation — used for long windows and as fallback when
    # ticks time out.  Returns the same {time, bid, ask} shape as real ticks.
    try:
        bars = _get_intraday_bars(ticker, start_dt, end_dt, 1)
        estimated = _estimate_spread_from_bars(bars)
        if estimated:
            return estimated
    except Exception:
        pass

    # Nothing worked — return empty so the SPA falls back to N/A gracefully.
    return []


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
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
