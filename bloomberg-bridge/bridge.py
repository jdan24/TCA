"""
Bloomberg FastAPI Bridge — stub (Phase 4)
Exposes a local REST API at http://localhost:8000 for the TCA SPA.

Setup:
    pip install fastapi uvicorn blpapi
    python bridge.py

TODO Phase 4: implement each endpoint with real blpapi calls.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Bloomberg TCA Bridge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # SPA runs on file:// or localhost in dev
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """SPA polls this endpoint for the status badge."""
    return {"status": "ok"}


@app.get("/snapshot")
def snapshot(securities: str = "", fields: str = ""):
    """Arrival price (PX_LAST) and reference data for a set of securities.
    TODO Phase 4: parse comma-separated securities/fields, call blpapi.
    """
    return {}


@app.get("/intraday-bars")
def intraday_bars(security: str = "", start: str = "", end: str = "", interval: int = 1):
    """VWAP, reversion marks, vol, ADV.
    TODO Phase 4: call blpapi IntradayBarRequest.
    """
    return []


@app.get("/reference")
def reference(security: str = "", fields: str = ""):
    """Contract multiplier, currency, ADV.
    TODO Phase 4: call blpapi ReferenceDataRequest.
    """
    return {}


@app.get("/bid-ask-ticks")
def bid_ask_ticks(security: str = "", start: str = "", end: str = ""):
    """Timestamped bid/ask pairs for TWAS calculation.
    TODO Phase 4: call blpapi IntradayTickRequest with eventTypes=[BID, ASK].
    """
    return []


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
