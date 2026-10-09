# Arena

AI-assisted research for Indian stocks (NSE/BSE). Pick a stock and a team of AI agents researches it: three analysts review fundamentals, price action and news, a bull and a bear argue the case over several rounds, a judge gives a Buy / Hold / Sell verdict, and a risk manager sizes the trade. The app also includes a screener, stock comparison, a backtester, a watchlist with alerts, and saved history.

> AI-generated research for education only. It is not investment advice and not a recommendation by a SEBI-registered research analyst.

## How it works

```
fetch data -> fundamentals ─┐
              technicals   ─┼─> bull <-> bear (1-4 rounds) -> judge -> risk plan
              news (search)─┘
```

- **Backend:** Python 3.12, FastAPI, LangGraph, Gemini (via `langchain-google-genai`), yfinance, SQLite.
- **Frontend:** React 19, Vite, Tailwind v4, TradingView lightweight-charts.
- Long jobs (analysis, backtest, screener scan) stream live progress to the browser over Server-Sent Events.

## Requirements

- Python 3.12
- Node.js 20 or newer (22 recommended)
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

### 1. Clone and create the backend environment

```bash
git clone https://github.com/abhishek261002/stock_market_agent.git
cd stock_market_agent

python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Add your API key

Copy the example settings file and put your key in it:

```bash
# Windows
copy .env.example .env
# macOS / Linux
cp .env.example .env
```

Open `.env` and set `GOOGLE_API_KEY`. The `.env` file is git-ignored, so your key stays local.

### 3. Install the frontend

```bash
cd frontend
npm install
cd ..
```

## Run

Use two terminals.

**Terminal 1, backend** (from the project root, with the venv active):

```bash
uvicorn api.main:app --port 8000
```

**Terminal 2, frontend:**

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**. API docs are at http://localhost:8000/docs.

Press `Ctrl K` (or `/`) anywhere in the app to search for a stock, then run an analysis from its page.

### Command line

You can also run one analysis without the UI:

```bash
python main.py INFY 2     # symbol, number of debate rounds
```

### Demo mode (no API quota)

To try the interface without calling Gemini, set `LLM_MOCK=1` in `.env`. The agents then return simulated responses. Market data stays live.

## Configuration

Settings live in `.env` (see `.env.example` for all of them).

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | none | Required unless `LLM_MOCK=1` |
| `LLM_MODEL` | `gemini-3.6-flash` | Primary model |
| `LLM_FALLBACK_MODELS` | see `.env.example` | Tried in order when a model's daily quota runs out |
| `LLM_RPM` | `5` | Requests per minute. The free tier allows about 5; raise it on a paid key |
| `LLM_MOCK` | `0` | `1` enables demo mode |
| `DEBATE_ROUNDS` | `2` | Default debate rounds (the UI allows 1 to 4) |
| `DB_PATH` | `storage/screener.db` | SQLite file for history, watchlist and alerts |
| `SCHEDULER_ENABLED` | `1` | Daily watchlist re-analysis and price-alert checks |

### About the free Gemini tier

The free tier is limited to roughly 5 requests per minute and a small number per day for each model. A 2-round analysis makes about 10 calls, so it takes one to three minutes. The app queues calls automatically and falls back to other Gemini models when one runs out for the day. For regular use, a paid key and a higher `LLM_RPM` are recommended.

## Tests

The test suite runs offline using a fake LLM and fake market data:

```bash
python -m pytest tests -q
```

For the frontend:

```bash
cd frontend
npx tsc -b        # typecheck
npm run lint
npm run build
```

## Project layout

```
agents/      analyst, debater, judge and risk agents, LLM client, output schemas
graph/       LangGraph pipeline and shared state
data/        Yahoo Finance fetcher, technical indicators, news, stock universe
services/    analysis runner, screener, backtest, compare, chat, scheduler
storage/     SQLite persistence
api/         FastAPI app
frontend/    React app
tests/       offline test suite
```

## Troubleshooting

- **"The API is not reachable" banner:** start the backend (`uvicorn api.main:app --port 8000`) before using the app.
- **Analysis fails with a quota message:** you have hit the free-tier limit for every configured model. Wait for the daily reset, use another key, or set `LLM_MOCK=1`.
- **A stock shows no data:** use Yahoo Finance tickers. NSE stocks end in `.NS` (for example `RELIANCE.NS`) and BSE stocks in `.BO`. Bare names like `INFY` are treated as NSE.
- **First screener load is slow:** it downloads a year of prices and fundamentals for about 90 stocks. The result is cached for six hours.
- **Data looks stale:** Yahoo Finance data can be delayed, and news comes from Google News.
