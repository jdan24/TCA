"""
Bloomberg TCA Bridge  — Flask version
======================================
Drop-in replacement for bridge.py that uses Flask instead of FastAPI.
Use this when FastAPI / uvicorn are unavailable in your environment.

Setup
-----
    pip install flask blpapi
    python bridge_flask.py
    # Runs on http://localhost:8000

The SPA polls /health to detect whether the bridge is running.
All other endpoints are called on demand (never on startup).

Session lifecycle: one blpapi session per request (simpler; adds ~1-2 s per
call). For datasets > 100 trades, consider refactoring to a persistent session.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Flask, jsonify, request

# ── blpapi import (graceful degradation when SDK not installed) ───────────────
try:
    import blpapi
    BLPAPI_AVAILABLE = True
except ImportError:
    blpapi = None  # type: ignore[assignment]
    BLPAPI_AVAILABLE = False

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)


@app.after_request
def _add_cors(response):
    """Allow the SPA (file:// or any origin) to call the bridge."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(503)
def _json_error(e):
    return jsonify({"detail": e.description}), e.code


# ── Yellow-key inference ──────────────────────────────────────────────────────
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

_ROOT_RE = re.compile(r"^([A-Z0-9]+?)[FGHJKMNQUVXZ]\d{1,2}$")


def extract_root(symbol: str) -> str:
    m = _ROOT_RE.match(symbol.upper().strip())
    return m.group(1) if m else symbol.upper().strip()


def resolve_ticker(symbol: str) -> str:
    root = extract_root(symbol)
    key = YELLOW_KEY.get(root, "Index")
    return f"{symbol.upper()} {key}"


# ── DateTime helpers ──────────────────────────────────────────────────────────

def parse_dt(s: str) -> datetime:
    s = s.strip()
    if len(s) >= 8 and s[8] == "-" and "T" not in s:
        fmt = "%Y%m%d-%H:%M:%S.%f" if "." in s else "%Y%m%d-%H:%M:%S"
        return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def to_blp_dt(dt: datetime) -> datetime:
    """Return a naive UTC datetime suitable for blpapi request.set()."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def blp_dt_to_iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        return datetime(
            value.year, value.month, value.day,
            value.hour, value.minute, value.second,
        ).isoformat()
    except Exception:
        return str(value)


# ── blpapi session helpers ────────────────────────────────────────────────────

def _require_blpapi():
    if not BLPAPI_AVAILABLE:
        from flask import abort
        abort(503, description="blpapi SDK is not installed. Run: pip install blpapi")


def _create_session():
    from flask import abort
    options = blpapi.SessionOptions()
    options.setServerHost("localhost")
    options.setServerPort(8194)
    session = blpapi.Session(options)
    if not session.start():
        abort(503, description="Failed to start Bloomberg session")
    if not session.openService("//blp/refdata"):
        session.stop()
        abort(503, description="Failed to open //blp/refdata service")
    return session


def _drain(session, timeout_ms: int = 15_000) -> list:
    """
    Collect response messages, ignoring session/admin housekeeping events.
    Raises 502 on REQUEST_STATUS (Bloomberg rejection), 504 on timeout.
    """
    from flask import abort
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
            for msg in event:
                try:
                    reason = msg.getElement("reason")
                    desc = reason.getElement("description").getValueAsString()
                    abort(502, description=f"Bloomberg request failed: {desc}")
                except Exception:
                    pass
            abort(502, description="Bloomberg request failed (unknown reason)")

        # Ignore SESSION_STATUS, SERVICE_STATUS, ADMIN, etc.

    abort(504, description="Bloomberg request timed out after 15 seconds")


# ── blpapi request helpers (unchanged from FastAPI version) ──────────────────

def _get_reference_data(ticker: str, fields: list[str]) -> dict[str, Any]:
    """
    ReferenceDataRequest for a single security.

    Handles Bloomberg field errors gracefully: invalid fields are omitted
    from the result and logged as warnings rather than raising exceptions.
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

                # Valid field values
                if sec.hasElement("fieldData"):
                    fld_data = sec.getElement("fieldData")
                    for j in range(fld_data.numElements()):
                        el = fld_data.getElement(j)
                        try:
                            result[str(el.name())] = el.getValue()
                        except Exception:
                            pass

                # Invalid fields — log and skip, don't crash
                if sec.hasElement("fieldExceptions"):
                    exc_arr = sec.getElement("fieldExceptions")
                    for k in range(exc_arr.numValues()):
                        exc = exc_arr.getValueAsElement(k)
                        try:
                            fid = exc.getElement("fieldId").getValueAsString()
                            msg_str = exc.getElement("errorInfo").getElement("message").getValueAsString()
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
        return bars
    finally:
        session.stop()


def _get_intraday_ticks(
    ticker: str,
    start: datetime,
    end: datetime,
    event_types: list[str],
) -> list[dict[str, Any]]:
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
        return raw_ticks
    finally:
        session.stop()


def _reconstruct_bid_ask_pairs(raw_ticks: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
            pairs.append({"time": tick["time"], "bid": current_bid, "ask": current_ask})
    return pairs


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "ok", "blpapi": BLPAPI_AVAILABLE})


@app.route("/snapshot")
def snapshot():
    security = request.args.get("security", "")
    dt_str = request.args.get("dt", "")
    if not security or not dt_str:
        from flask import abort
        abort(400, description="Missing required query params: security, dt")

    _require_blpapi()
    ticker = resolve_ticker(security)
    target = parse_dt(dt_str)
    start = target - timedelta(minutes=5)
    end = target + timedelta(seconds=30)

    try:
        raw = _get_intraday_ticks(ticker, start, end, ["BID", "ASK"])
        pairs = _reconstruct_bid_ask_pairs(raw)
        target_iso = target.isoformat()
        best = None
        for p in pairs:
            if p["time"] <= target_iso:
                best = p
        if best:
            return jsonify({"arrivalPrice": round((best["bid"] + best["ask"]) / 2, 6)})
    except Exception:
        pass

    try:
        bars = _get_intraday_bars(ticker, start, end, 1)
        target_iso = target.isoformat()
        last_bar = None
        for bar in bars:
            if bar["time"] <= target_iso:
                last_bar = bar
        if last_bar:
            return jsonify({"arrivalPrice": last_bar["open"]})
    except Exception:
        pass

    from flask import abort
    abort(404, description=f"No price data for {ticker} at {dt_str}")


@app.route("/intraday-bars")
def intraday_bars():
    security = request.args.get("security", "")
    start_str = request.args.get("start", "")
    end_str = request.args.get("end", "")
    interval = int(request.args.get("interval", "1"))
    if not security or not start_str or not end_str:
        from flask import abort
        abort(400, description="Missing required query params: security, start, end")

    _require_blpapi()
    ticker = resolve_ticker(security)
    return jsonify(_get_intraday_bars(ticker, parse_dt(start_str), parse_dt(end_str), interval))


@app.route("/reference")
def reference():
    security = request.args.get("security", "")
    fields_str = request.args.get("fields", "HIST_VOL_30D,VOLUME_AVG_30D,FUT_CONT_SIZE,CRNCY")
    if not security:
        from flask import abort
        abort(400, description="Missing required query param: security")

    _require_blpapi()
    ticker = resolve_ticker(security)
    field_list = [f.strip() for f in fields_str.split(",") if f.strip()]
    return jsonify(_get_reference_data(ticker, field_list))


@app.route("/bid-ask-ticks")
def bid_ask_ticks():
    security = request.args.get("security", "")
    start_str = request.args.get("start", "")
    end_str = request.args.get("end", "")
    if not security or not start_str or not end_str:
        from flask import abort
        abort(400, description="Missing required query params: security, start, end")

    _require_blpapi()
    ticker = resolve_ticker(security)
    raw = _get_intraday_ticks(ticker, parse_dt(start_str), parse_dt(end_str), ["BID", "ASK"])
    return jsonify(_reconstruct_bid_ask_pairs(raw))


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Bloomberg TCA Bridge (Flask) running on http://127.0.0.1:8000")
    app.run(host="127.0.0.1", port=8000, debug=False)
