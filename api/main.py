# =============================================================================
# api/main.py
# =============================================================================
# The HTTP layer. Long-running jobs (analysis, backtest, screener scan, chat)
# stream progress over Server-Sent Events; everything else is plain JSON.
#
# Run:  uvicorn api.main:app --reload --port 8000
#
# SSE PATTERN (stream_job): the blocking job runs in a worker thread and pushes
# events into an asyncio.Queue via an `emit` callback; the async generator
# drains the queue and yields them to the browser as they arrive.
# .NET ANALOGY: Channel<T> + IAsyncEnumerable<T> streamed from a controller.
# =============================================================================

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Any, Callable, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

load_dotenv()

from config import (ANALYSE_RATE_LIMIT_PER_MIN, CORS_ORIGINS, DEBATE_ROUNDS, DISCLAIMER, LLM_MODEL,  # noqa: E402
                    MAX_DEBATE_ROUNDS, SCHEDULER_ENABLED)
from agents.llm import model_status  # noqa: E402
from data.fetcher import get_stock_detail  # noqa: E402
from data.news import company_query, search_news  # noqa: E402
from data.universe import lookup, normalise_symbol, search_universe  # noqa: E402
from services import scheduler  # noqa: E402
from services.analysis import run_and_save  # noqa: E402
from services.backtest import run_backtest  # noqa: E402
from services.chat import stream_answer  # noqa: E402
from services.compare import compare_stocks  # noqa: E402
from services.market import latest_prices, market_overview  # noqa: E402
from services.screener import PRESETS, build_universe, parse_query, rank_shortlist  # noqa: E402
from storage import db  # noqa: E402


# =============================================================================
# APP SETUP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    tasks: list = []
    if SCHEDULER_ENABLED:
        scheduler.start(tasks)
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Stock Screener Agent API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# HELPERS
# =============================================================================

def safe(obj: Any) -> Any:
    """Recursively replaces NaN/Infinity (invalid JSON) with None."""
    if isinstance(obj, float):
        return None if math.isnan(obj) or math.isinf(obj) else obj
    if isinstance(obj, dict):
        return {str(k): safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [safe(v) for v in obj]
    if hasattr(obj, "item") and callable(obj.item):     # numpy scalars
        try:
            return safe(obj.item())
        except Exception:
            return str(obj)
    return obj


def ok(obj: Any) -> JSONResponse:
    return JSONResponse(safe(obj))


_SYMBOL_RE = re.compile(r"^[A-Z0-9&\-\^=]{1,20}(\.(NS|BO))?$")


def clean_symbol(raw: str) -> str:
    s = normalise_symbol(raw or "")
    if not _SYMBOL_RE.match(s):
        raise HTTPException(400, f"Invalid symbol '{raw}'. Use NSE tickers like INFY or INFY.NS")
    return s


_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def rate_limit(request: Request, bucket: str, per_min: int = ANALYSE_RATE_LIMIT_PER_MIN) -> None:
    key = f"{bucket}:{request.client.host if request.client else 'anon'}"
    now = time.time()
    with _hits_lock:
        q = _hits[key]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= per_min:
            raise HTTPException(429, f"Rate limit: max {per_min} {bucket} requests per minute. Try again shortly.")
        q.append(now)


def sse(payload: dict) -> dict:
    return {"data": json.dumps(safe(payload))}


def stream_job(job: Callable[[Callable[[dict], None]], Any], result_type: str = "complete"):
    """Runs job(emit) in a thread; yields every emitted event, then the result."""
    async def gen():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        DONE = object()

        def emit(event: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, event)

        def worker():
            try:
                result = job(emit)
                loop.call_soon_threadsafe(queue.put_nowait, {"type": result_type, "result": result})
            except Exception as e:
                print(f"[API] job failed: {e}")
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(e)})
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, DONE)

        threading.Thread(target=worker, daemon=True).start()
        while True:
            item = await queue.get()
            if item is DONE:
                break
            yield sse(item)

    return EventSourceResponse(gen(), ping=10)


# =============================================================================
# REQUEST MODELS
# =============================================================================

class AnalyseRequest(BaseModel):
    symbol: str
    rounds: int = Field(default=DEBATE_ROUNDS, ge=1, le=MAX_DEBATE_ROUNDS)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    analysis_id: str
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)


class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)


class RankRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=15)
    query: str = ""


class CompareRequest(BaseModel):
    symbols: list[str] = Field(min_length=2, max_length=4)


class BacktestRequest(BaseModel):
    symbol: str
    points: int = Field(default=10, ge=3, le=24)
    horizon: int = Field(default=21, ge=5, le=63)


class WatchRequest(BaseModel):
    symbol: str


class PriceAlertRequest(BaseModel):
    symbol: str
    direction: Literal["above", "below"]
    price: float = Field(gt=0)


class ReadRequest(BaseModel):
    ids: Optional[list[int]] = None


# =============================================================================
# META
# =============================================================================

@app.get("/")
@app.get("/api/health")
async def health():
    return {"message": "Stock Screener Agent API is running.", "status": "ok"}


@app.get("/api/config")
async def get_config():
    status = model_status()
    return {"model": status["active"] or LLM_MODEL, "models": status, "default_rounds": DEBATE_ROUNDS,
            "max_rounds": MAX_DEBATE_ROUNDS, "llm_rpm": int(os.getenv("LLM_RPM", "5")),
            "disclaimer": DISCLAIMER, "scheduler": scheduler.scheduler_state()}


# =============================================================================
# MARKET & STOCK DATA
# =============================================================================

@app.get("/api/market/overview")
async def get_market_overview():
    try:
        return ok(await asyncio.to_thread(market_overview))
    except Exception as e:
        raise HTTPException(502, f"Market data unavailable: {e}")


@app.get("/api/search")
async def search(q: str = ""):
    results = search_universe(q)
    norm = normalise_symbol(q)
    if q.strip() and not results and _SYMBOL_RE.match(norm):
        results = [{"symbol": norm, "name": "Search Yahoo for this ticker", "sector": None}]
    return results


@app.get("/api/stock/{symbol}")
async def get_stock(symbol: str):
    s = clean_symbol(symbol)
    try:
        detail = await asyncio.to_thread(get_stock_detail, s)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not load {s}: {e}")
    detail["in_watchlist"] = db.in_watchlist(s)
    detail["history"] = db.list_analyses(s, 10)
    return ok(detail)


@app.get("/api/stock/{symbol}/news")
async def get_news(symbol: str):
    s = clean_symbol(symbol)
    name = (lookup(s) or {}).get("name") or s.split(".")[0]
    return ok(await asyncio.to_thread(search_news, company_query(name, s), 15))


# =============================================================================
# ANALYSIS (the multi-agent debate)
# =============================================================================

@app.post("/api/analyse")
@app.post("/analyse")
async def analyse(req: AnalyseRequest, request: Request):
    s = clean_symbol(req.symbol)
    rate_limit(request, "analysis")
    print(f"\n[API] Analysis requested: {s} ({req.rounds} rounds)")
    return stream_job(lambda emit: run_and_save(s, req.rounds, emit))


@app.get("/api/analyses")
async def list_analyses(symbol: Optional[str] = None, limit: int = 50):
    return ok(db.list_analyses(clean_symbol(symbol) if symbol else None, min(limit, 200)))


@app.get("/api/analyses/{aid}")
async def get_analysis(aid: str):
    a = db.get_analysis(aid)
    if not a:
        raise HTTPException(404, "Analysis not found")
    return ok(a)


@app.delete("/api/analyses/{aid}")
async def delete_analysis(aid: str):
    if not db.delete_analysis(aid):
        raise HTTPException(404, "Analysis not found")
    return {"deleted": aid}


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    rate_limit(request, "chat", 30)
    analysis = db.get_analysis(req.analysis_id)
    if not analysis:
        raise HTTPException(404, "Analysis not found")
    msgs = [m.model_dump() for m in req.messages]

    def job(emit):
        parts = []
        for piece in stream_answer(analysis, msgs):
            parts.append(piece)
            emit({"type": "token", "text": piece})
        return "".join(parts)
    return stream_job(job)


# =============================================================================
# SCREENER
# =============================================================================

@app.get("/api/screener/presets")
async def screener_presets():
    return PRESETS


@app.get("/api/screener/universe")
async def screener_universe(force: bool = False):
    return stream_job(lambda emit: build_universe(
        lambda p: emit({"type": "progress", **p}), force=force))


@app.post("/api/screener/parse")
async def screener_parse(req: QueryRequest, request: Request):
    rate_limit(request, "screener AI", 20)
    try:
        return ok(await asyncio.to_thread(parse_query, req.query))
    except Exception as e:
        raise HTTPException(502, f"Could not interpret query: {e}")


@app.post("/api/screener/rank")
async def screener_rank(req: RankRequest, request: Request):
    rate_limit(request, "screener AI", 20)
    uni = await asyncio.to_thread(build_universe)
    by_sym = {r["symbol"]: r for r in uni["rows"]}
    rows = [by_sym[s] for s in (clean_symbol(x) for x in req.symbols) if s in by_sym]
    if not rows:
        raise HTTPException(400, "None of those symbols are in the screener universe")
    try:
        return ok(await asyncio.to_thread(rank_shortlist, rows, req.query))
    except Exception as e:
        raise HTTPException(502, f"Ranking failed: {e}")


# =============================================================================
# COMPARE & BACKTEST
# =============================================================================

@app.post("/api/compare")
async def compare(req: CompareRequest, request: Request):
    rate_limit(request, "compare")
    symbols = [clean_symbol(s) for s in req.symbols]
    try:
        return ok(await asyncio.to_thread(compare_stocks, symbols))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Comparison failed: {e}")


@app.post("/api/backtest")
async def backtest(req: BacktestRequest, request: Request):
    s = clean_symbol(req.symbol)
    rate_limit(request, "backtest", 5)

    def job(emit):
        result = run_backtest(s, req.points, req.horizon, lambda p: emit({"type": "progress", **p}))
        db.save_backtest(result)
        return result
    return stream_job(job)


@app.get("/api/backtests")
async def backtests():
    return ok(db.list_backtests())


@app.get("/api/backtests/{bid}")
async def get_backtest(bid: str):
    b = db.get_backtest(bid)
    if not b:
        raise HTTPException(404, "Backtest not found")
    return ok(b)


# =============================================================================
# WATCHLIST & ALERTS
# =============================================================================

@app.get("/api/watchlist")
async def get_watchlist():
    items = db.get_watchlist()
    syms = tuple(sorted(i["symbol"] for i in items))
    try:
        prices = await asyncio.to_thread(latest_prices, syms) if syms else {}
    except Exception:
        prices = {}
    for i in items:
        i["price"] = prices.get(i["symbol"])
        la = i.get("last_analysis")
        if la and la.get("price") and i["price"]:
            i["change_since_analysis_pct"] = round((i["price"] - la["price"]) / la["price"] * 100, 2)
    return ok(items)


@app.post("/api/watchlist")
async def add_watch(req: WatchRequest):
    s = clean_symbol(req.symbol)
    db.add_to_watchlist(s, (lookup(s) or {}).get("name"))
    return {"added": s}


@app.delete("/api/watchlist/{symbol}")
async def remove_watch(symbol: str):
    s = clean_symbol(symbol)
    db.remove_from_watchlist(s)
    return {"removed": s}


@app.post("/api/watchlist/refresh")
async def refresh_watchlist():
    if scheduler.scheduler_state()["watchlist_running"]:
        return {"status": "already running"}
    threading.Thread(target=scheduler.refresh_watchlist_sync, daemon=True).start()
    return {"status": "started"}


@app.get("/api/alerts")
async def alerts(unread_only: bool = False):
    items = db.list_alerts(unread_only)
    return {"items": items, "unread": sum(1 for a in items if not a["read"])}


@app.post("/api/alerts/read")
async def read_alerts(req: ReadRequest):
    db.mark_alerts_read(req.ids)
    return {"ok": True}


@app.get("/api/price-alerts")
async def price_alerts():
    return db.list_price_alerts(active_only=False)


@app.post("/api/price-alerts")
async def add_price_alert(req: PriceAlertRequest):
    s = clean_symbol(req.symbol)
    return {"id": db.add_price_alert(s, req.direction, req.price)}


@app.delete("/api/price-alerts/{pid}")
async def delete_price_alert(pid: int):
    if not db.delete_price_alert(pid):
        raise HTTPException(404, "Price alert not found")
    return {"deleted": pid}
