# =============================================================================
# services/screener.py
# =============================================================================
# THE SCREENER — scans the whole universe (data/universe.py) and produces one
# row of metrics + composite scores per stock. Then:
#   apply_filters(rows, ScreenerFilters) → deterministic filtering & sorting
#   parse_query("cheap IT stocks...")    → LLM turns English into ScreenerFilters
#   rank_shortlist(rows, query)          → LLM ranks the survivors with a thesis
#
# Scores (0-100) are PERCENTILE RANKS within the universe, so "quality 85"
# means better than 85% of the universe on that blend of metrics.
# =============================================================================

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Optional

import pandas as pd
import yfinance as yf
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import ScreenerFilters, ScreenerRanking
from data.fetcher import get_info
from data.technicals import pct_change_over, rsi, sma, annualised_volatility
from data.universe import UNIVERSE, BENCHMARK
from storage import db

CACHE_KEY = "screener_universe_v1"
CACHE_TTL = 6 * 3600
SECTORS = sorted({u["sector"] for u in UNIVERSE})

PRESETS: list[dict] = [
    {"id": "quality", "label": "Quality compounders", "icon": "gem",
     "description": "High ROE, healthy margins, low debt",
     "filters": {"roe_min": 18, "profit_margin_min": 12, "de_max": 0.6, "sort_by": "quality_score"}},
    {"id": "value", "label": "Value picks", "icon": "tag",
     "description": "Low P/E and P/B with positive ROE",
     "filters": {"pe_max": 18, "pb_max": 3, "roe_min": 10, "sort_by": "value_score"}},
    {"id": "momentum", "label": "Momentum leaders", "icon": "rocket",
     "description": "Above 200-DMA, strong 1-year run",
     "filters": {"above_sma200": True, "change_1y_min": 15, "sort_by": "momentum_score"}},
    {"id": "oversold", "label": "Oversold bounce", "icon": "trending-down",
     "description": "RSI under 35, a possible mean-reversion setup",
     "filters": {"rsi_max": 35, "sort_by": "rsi_14", "sort_desc": False}},
    {"id": "dividend", "label": "Dividend income", "icon": "coins",
     "description": "Dividend yield above 2.5%",
     "filters": {"dividend_yield_min": 2.5, "sort_by": "dividend_yield"}},
    {"id": "breakout", "label": "Near 52-week high", "icon": "mountain",
     "description": "Within 5% of the 52-week high",
     "filters": {"near_52w_high_pct": 5, "above_sma200": True, "sort_by": "change_1m_pct"}},
]


# =============================================================================
# UNIVERSE SNAPSHOT
# =============================================================================

def _downsample(values: list[float], n: int = 40) -> list[float]:
    if len(values) <= n:
        return values
    step = len(values) / n
    return [values[int(i * step)] for i in range(n - 1)] + [values[-1]]


def _price_rows(hist: dict[str, pd.DataFrame], bench: Optional[pd.Series]) -> dict[str, dict]:
    rows = {}
    bench_3m = pct_change_over(bench, 63) if bench is not None and not bench.empty else None
    for u in UNIVERSE:
        df = hist.get(u["symbol"])
        if df is None or df.empty or len(df) < 30:
            continue
        close = df["Close"].dropna()
        price = float(close.iloc[-1])
        s200 = sma(close, 200).iloc[-1]
        s50 = sma(close, 50).iloc[-1]
        r = rsi(close).iloc[-1]
        hi = float(df["High"].max())
        c3m = pct_change_over(close, 63)
        rows[u["symbol"]] = {
            **u,
            "price":             round(price, 2),
            "change_1d_pct":     pct_change_over(close, 1),
            "change_1w_pct":     pct_change_over(close, 5),
            "change_1m_pct":     pct_change_over(close, 21),
            "change_3m_pct":     c3m,
            "change_1y_pct":     pct_change_over(close, min(len(close) - 1, 250)),
            "rsi_14":            None if pd.isna(r) else round(float(r), 1),
            "sma_50":            None if pd.isna(s50) else round(float(s50), 2),
            "sma_200":           None if pd.isna(s200) else round(float(s200), 2),
            "above_sma200":      None if pd.isna(s200) else bool(price > s200),
            "pct_from_52w_high": round((price - hi) / hi * 100, 2) if hi else None,
            "volatility_ann":    annualised_volatility(close),
            "rel_strength_3m":   round(c3m - bench_3m, 2) if c3m is not None and bench_3m is not None else None,
            "volume_ratio":      round(float(df["Volume"].iloc[-1] / df["Volume"].tail(20).mean()), 2)
                                 if df["Volume"].tail(20).mean() else None,
            "sparkline":         _downsample([round(float(x), 2) for x in close.tail(120).tolist()]),
        }
    return rows


def _fundamental_fields(info: dict) -> dict:
    def pct(k):
        v = info.get(k)
        return None if v is None else round(float(v) * 100, 2)

    def num(k):
        v = info.get(k)
        try:
            return None if v is None else round(float(v), 2)
        except (TypeError, ValueError):
            return None

    d2e = info.get("debtToEquity")
    return {
        "name":             info.get("longName") or info.get("shortName"),
        "market_cap":       info.get("marketCap"),
        "pe_ratio":         num("trailingPE"),
        "forward_pe":       num("forwardPE"),
        "price_to_book":    num("priceToBook"),
        "return_on_equity": pct("returnOnEquity"),
        "revenue_growth":   pct("revenueGrowth"),
        "earnings_growth":  pct("earningsGrowth"),
        "profit_margin":    pct("profitMargins"),
        "debt_to_equity":   round(float(d2e) / 100, 2) if d2e is not None else None,
        "dividend_yield":   num("dividendYield"),
        "beta":             num("beta"),
        "analyst_rating":   info.get("recommendationKey"),
        "target_upside_pct": (round((info["targetMeanPrice"] - info["currentPrice"]) / info["currentPrice"] * 100, 2)
                              if info.get("targetMeanPrice") and info.get("currentPrice") else None),
    }


def _pct_rank(series: pd.Series, higher_is_better: bool = True) -> pd.Series:
    r = series.rank(pct=True, ascending=higher_is_better)
    return r.fillna(0.5)


def add_scores(rows: list[dict]) -> list[dict]:
    """Adds quality/value/momentum/overall percentile scores (0-100)."""
    if not rows:
        return rows
    df = pd.DataFrame(rows)

    def col(name):
        return pd.to_numeric(df.get(name), errors="coerce") if name in df else pd.Series([None] * len(df))

    pe = col("pe_ratio").where(col("pe_ratio") > 0)      # negative P/E = losses → treat as missing
    quality = (_pct_rank(col("return_on_equity")) + _pct_rank(col("profit_margin"))
               + _pct_rank(col("debt_to_equity"), higher_is_better=False) + _pct_rank(col("earnings_growth"))) / 4
    value = (_pct_rank(pe, higher_is_better=False) + _pct_rank(col("price_to_book"), higher_is_better=False)
             + _pct_rank(col("dividend_yield"))) / 3
    momentum = (_pct_rank(col("change_3m_pct")) + _pct_rank(col("change_1y_pct"))
                + _pct_rank(col("rel_strength_3m")) + _pct_rank(col("pct_from_52w_high"))) / 4
    overall = (quality + value + momentum) / 3
    for i, r in enumerate(rows):
        r["quality_score"] = int(round(quality.iloc[i] * 100))
        r["value_score"] = int(round(value.iloc[i] * 100))
        r["momentum_score"] = int(round(momentum.iloc[i] * 100))
        r["overall_score"] = int(round(overall.iloc[i] * 100))
    return rows


def _download_prices(symbols: list[str]) -> dict[str, pd.DataFrame]:
    raw = yf.download(symbols, period="1y", group_by="ticker", progress=False, threads=True, auto_adjust=True)
    out = {}
    for s in symbols:
        try:
            df = raw[s].dropna(subset=["Close"]) if s in raw.columns.get_level_values(0) else pd.DataFrame()
        except Exception:
            df = pd.DataFrame()
        if not df.empty:
            df.index = pd.to_datetime(df.index).tz_localize(None)
            out[s] = df
    return out


def build_universe(progress: Optional[Callable[[dict], None]] = None, force: bool = False) -> dict:
    """Returns {"rows": [...], "built_at": ts, "sectors": [...]}, from cache when fresh."""
    if not force:
        cached = db.cache_get(CACHE_KEY)
        if cached:
            return cached

    def report(**kw):
        if progress:
            progress(kw)

    symbols = [u["symbol"] for u in UNIVERSE]
    report(phase="prices", done=0, total=len(symbols), message="Downloading 1-year price history…")
    hist = _download_prices(symbols + [BENCHMARK])
    bench = hist.get(BENCHMARK)
    rows = _price_rows(hist, bench["Close"] if bench is not None else None)
    report(phase="prices", done=len(symbols), total=len(symbols), message=f"Prices for {len(rows)} stocks")

    done = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(get_info, s): s for s in rows}
        for f in as_completed(futures):
            s = futures[f]
            try:
                fields = _fundamental_fields(f.result())
                if not fields.get("name"):          # keep the universe's curated name
                    fields.pop("name")
                rows[s].update(fields)
            except Exception as e:
                print(f"[Screener] fundamentals failed for {s}: {e}")
            done += 1
            if done % 5 == 0 or done == len(rows):
                report(phase="fundamentals", done=done, total=len(rows), message=f"Fundamentals {done}/{len(rows)}")

    result = {"rows": add_scores(list(rows.values())), "built_at": time.time(), "sectors": SECTORS}
    db.cache_set(CACHE_KEY, result, CACHE_TTL)
    report(phase="done", done=len(rows), total=len(rows), message="Universe ready")
    return result


# =============================================================================
# FILTERING
# =============================================================================

_RANGE_FIELDS = [
    # (filter_key, row_key, is_min)
    ("pe_min", "pe_ratio", True), ("pe_max", "pe_ratio", False),
    ("pb_max", "price_to_book", False),
    ("roe_min", "return_on_equity", True),
    ("de_max", "debt_to_equity", False),
    ("revenue_growth_min", "revenue_growth", True),
    ("profit_margin_min", "profit_margin", True),
    ("dividend_yield_min", "dividend_yield", True),
    ("rsi_min", "rsi_14", True), ("rsi_max", "rsi_14", False),
    ("change_1m_min", "change_1m_pct", True), ("change_1m_max", "change_1m_pct", False),
    ("change_1y_min", "change_1y_pct", True),
]


def apply_filters(rows: list[dict], f: ScreenerFilters | dict) -> list[dict]:
    if isinstance(f, dict):
        f = ScreenerFilters(**f)
    out = []
    for r in rows:
        if f.sectors and r.get("sector") not in f.sectors:
            continue
        ok = True
        for key, field, is_min in _RANGE_FIELDS:
            bound = getattr(f, key)
            if bound is None:
                continue
            v = r.get(field)
            if v is None:
                ok = False
                break
            if key.startswith("pe_") and v <= 0:      # loss-makers never pass a P/E screen
                ok = False
                break
            if (is_min and v < bound) or (not is_min and v > bound):
                ok = False
                break
        if not ok:
            continue
        if f.market_cap_min_cr is not None and (r.get("market_cap") or 0) < f.market_cap_min_cr * 1e7:
            continue
        if f.above_sma200 is not None and r.get("above_sma200") is not f.above_sma200:
            continue
        if f.near_52w_high_pct is not None:
            d = r.get("pct_from_52w_high")
            if d is None or d < -abs(f.near_52w_high_pct):
                continue
        out.append(r)

    def key(r):
        v = r.get(f.sort_by)
        return (v is None, -(v or 0) if f.sort_desc else (v or 0))
    return sorted(out, key=key)


# =============================================================================
# LLM HELPERS
# =============================================================================

def parse_query(query: str) -> dict:
    """Natural language → ScreenerFilters (as dict)."""
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You convert an investor's plain-English stock screen into structured filters for an
Indian large/mid-cap universe. Only set filters the query implies; leave everything else null.
Allowed sectors (use these exact labels): {sectors}
Conventions: percentages are plain numbers (ROE 15% → 15); debt-to-equity is a ratio (low debt → de_max 0.5);
'cheap/undervalued' → pe_max ~20 and/or pb_max ~3 and sort_by value_score; 'quality' → roe_min ~15,
sort_by quality_score; 'momentum/trending' → above_sma200 true, sort_by momentum_score;
'oversold' → rsi_max 35; 'large cap' → market_cap_min_cr 100000; 'mid cap' → market_cap_min_cr 20000.
Write a one-sentence explanation of your interpretation."""),
        ("human", "{query}"),
    ])
    chain = prompt | structured(ScreenerFilters, temperature=0)
    f = invoke_with_retry(chain, {"query": query, "sectors": ", ".join(SECTORS)}, schema=ScreenerFilters)
    f.sectors = [s for s in f.sectors if s in SECTORS]
    return f.model_dump()


def rank_shortlist(rows: list[dict], query: str = "", limit: int = 10) -> dict:
    shortlist = rows[:limit]
    if not shortlist:
        return {"summary": "No stocks matched.", "picks": []}

    def f(v, s=""):
        return "N/A" if v is None else f"{v:.1f}{s}"
    table = "\n".join(
        f"{r['symbol']} ({r.get('name', '')}, {r.get('sector')}): P/E {f(r.get('pe_ratio'))}, "
        f"P/B {f(r.get('price_to_book'))}, ROE {f(r.get('return_on_equity'), '%')}, "
        f"margin {f(r.get('profit_margin'), '%')}, rev growth {f(r.get('revenue_growth'), '%')}, "
        f"D/E {f(r.get('debt_to_equity'))}, 1M {f(r.get('change_1m_pct'), '%')}, 1Y {f(r.get('change_1y_pct'), '%')}, "
        f"RSI {f(r.get('rsi_14'))}, scores Q{r.get('quality_score')}/V{r.get('value_score')}/M{r.get('momentum_score')}"
        for r in shortlist
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a portfolio manager ranking a screened shortlist of Indian stocks.
Rank every stock (1 = most attractive) for the investor's intent, balancing quality, valuation and momentum.
Give each a 0-10 score, a one-sentence thesis and one key risk, citing numbers. Use the exact symbols given.
This is educational research, not personalised advice."""),
        ("human", "Investor intent: {query}\n\nSHORTLIST:\n{table}"),
    ])
    chain = prompt | structured(ScreenerRanking, temperature=0.2)
    res = invoke_with_retry(chain, {"query": query or "best overall risk/reward", "table": table},
                            schema=ScreenerRanking).model_dump()
    valid = {r["symbol"] for r in shortlist}
    res["picks"] = sorted([p for p in res["picks"] if p["symbol"] in valid], key=lambda p: p["rank"])
    return res
