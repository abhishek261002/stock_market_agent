# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Arena** — an AI stock research product for Indian equities (NSE/BSE). A LangGraph multi-agent pipeline
(fundamentals / technical / news analysts → multi-round Bull vs Bear debate → Judge → Risk manager) plus a
screener, compare, backtester, watchlist with alerts, and a React trading-terminal UI. The code is heavily
commented in a ".NET analogy" learning style — keep that style in new code.

## Running

```bash
# Backend (from repo root, Windows venv)
venv\Scripts\activate
pip install -r requirements.txt
uvicorn api.main:app --port 8000          # API + background scheduler
python main.py INFY 2                      # CLI: one analysis, 2 debate rounds
python -m pytest tests -q                  # offline test-suite (fake LLM + fake market data)

# Frontend
cd frontend && npm install && npm run dev  # http://localhost:5173 (proxies /api → :8000)
npm run build                              # tsc -b + vite build
```

`LLM_MOCK=1` runs every agent on a deterministic mock LLM (demo mode, no API quota). See `.env.example`.

## Architecture

- **`data/`** — `fetcher.py` (Yahoo Finance via yfinance; `fetch_stock_data` DTO, `format_for_agent` prompt text,
  `get_stock_detail` UI payload), `technicals.py` (pure-pandas RSI/MACD/ATR… — Wilder smoothing, unit-tested
  against StockCharts reference values), `news.py` (Google News RSS), `universe.py` (screener universe + sectors),
  `cache.py` (`@ttl_cache`).
- **`agents/`** — one module per agent, each exposing `create_x_agent()` + `run_x_analysis()`; all return
  Pydantic models from `schemas.py` via `with_structured_output` (no regex parsing). `llm.py` owns model creation,
  the process-wide rate limiter (`LLM_RPM`), 429 retry with server hints, and per-day model failover
  (`LLM_MODEL` → `LLM_FALLBACK_MODELS`). `debater.py` is shared by bull/bear. `risk_agent.py` computes numbers
  deterministically; the LLM only comments.
- **`graph/`** — `state.py` (AgentState with reducers for parallel writes), `pipeline.py` (StateGraph with
  fan-out/fan-in, conditional debate loop with convergence stop, progress events via
  `config["configurable"]["emit"]`). The single engine for CLI and API.
- **`services/`** — `analysis.py` (run + persist + verdict-flip alerts + judge memory), `screener.py`,
  `market.py`, `backtest.py`, `compare.py`, `chat.py`, `scheduler.py` (asyncio jobs).
- **`storage/db.py`** — SQLite (analyses, watchlist, alerts, price alerts, backtests, kv cache).
- **`api/main.py`** — FastAPI; long jobs stream SSE via `stream_job(job(emit))`. All JSON goes through `safe()`
  (NaN → null).
- **`frontend/`** — React 19 + Vite + Tailwind v4 + motion + lightweight-charts v5 + react-router.
  `src/lib/api.ts` (typed client + SSE reader), `hooks/useAnalysisStream.ts` (SSE → live debate state),
  `pages/*` (code-split routes), `components/analysis/*` (agent graph, debate, verdict, risk, chat).

## Conventions to preserve

- Symbols are Yahoo tickers: NSE `.NS`, BSE `.BO`. `normalise_symbol()` adds `.NS` to bare tickers.
- Units are normalised in `fetcher.py`: growth/margins/ROE/dividend yield are **percent**, debt-to-equity is a
  **ratio**. Prompt text goes through `fmt()` in `format_for_agent` — don't interpolate raw values.
- Changing a schema in `agents/schemas.py` changes the API contract — update `frontend/src/lib/types.ts` too.
- Each agent module calls `load_dotenv()` at import time; keep that pattern for new agents.
- Gemini 3 multi-turn tool calling needs thought signatures the pinned `langchain-google-genai` 2.0.x can't
  round-trip, so tool use is plan-then-execute (see `agents/news_agent.py`). Don't switch to `bind_tools` loops
  without upgrading the LangChain stack.
- Free-tier Gemini is ~5 requests/min and ~20/day per model; a 2-round analysis makes ~10 calls.
