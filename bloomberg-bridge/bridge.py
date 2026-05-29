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

import re
import time
from datetime import datetime, timezone
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
    """Return the full Bloomberg ticker, e.g. 'ESH4' → 'ESH4 Index'."""
    root = extract_root(symbol)
    key = YELLOW_KEY.get(root, "Index")
    return f"{symbol.upper()} {key}"


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


def to_blp_dt(dt: datetime):  # type: ignore[return]
    """Convert a Python datetime to a blpapi.Datetime (UTC)."""
    if not BLPAPI_AVAILABLE:
        return None
    return blpapi.Datetime(
        dt.year, dt.month, dt.day,
        dt.hour, dt.minute, dt.second,
        dt.microsecond // 1000,
        offset=0,
    )


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
    """Collect all messages until a RESPONSE event (or timeout)."""
    messages = []
    deadline = time.monotonic() + timeout_ms / 1_000
    while time.monotonic() < deadline:
        remaining_ms = max(100, int((deadline - time.monotonic()) * 1_000))
        event = session.nextEvent(remaining_ms)
        for msg in event:
            messages.append(msg)
        if event.eventType() == blpapi.Event.RESPONSE:
            break
    return messages


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

                # Invalid fields return fieldExceptions — log and skip, don't crash
                if sec.hasElement("fieldExceptions"):
                    exc_arr = sec.getElement("fieldExceptions")
                    for k in range(exc_arr.numValues()):
                        exc = exc_arr.getValueAsElement(k)
                        try:
                            fid = exc.getElement("fieldId").getValueAsString()
                            err_info = exc.getElement("errorInfo")
                            msg_str = err_info.getElement("message").getValueAsString()
                            print(f"[WARN] Bloomberg field not valid for {ticker}: {fid} — {msg_str}")
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
            bar_tick_data = (
                msg.getElement("barData").getElement("barTickData")
            )
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
        return bars
    finally:
        session.stop()


def _get_intraday_ticks(
    ticker: str,
    start: datetime,
    end: datetime,
    event_types: list[str],
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
        for msg in _drain(session):
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
        return raw_ticks
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
    from datetime import timedelta
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


@app.get("/bid-ask-ticks")
def bid_ask_ticks(security: str, start: str, end: str):
    """
    Bid/ask tick stream for TWAS calculation (and arrival price mid-point).

    Returns a chronological list of paired {time, bid, ask} quotes.
    Each entry reflects the prevailing best bid and ask after a quote update.

    Query params:
      security  bare ticker, e.g. 'ESH4'
      start     ISO-8601 or FIX datetime
      end       ISO-8601 or FIX datetime
    """
    _require_blpapi()
    ticker = resolve_ticker(security)
    raw = _get_intraday_ticks(ticker, parse_dt(start), parse_dt(end), ["BID", "ASK"])
    return _reconstruct_bid_ask_pairs(raw)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
