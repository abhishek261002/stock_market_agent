# =============================================================================
# services/compare.py
# =============================================================================
# Head-to-head comparison of 2-4 stocks: side-by-side metrics + an LLM verdict.
# =============================================================================

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import CompareVerdict
from data.fetcher import fetch_stock_data, format_for_agent, get_history

COMPARE_FIELDS = [
    "current_price", "change_1d_pct", "market_cap", "pe_ratio", "forward_pe", "price_to_book", "peg_ratio",
    "return_on_equity", "profit_margin", "operating_margin", "revenue_growth", "earnings_growth",
    "debt_to_equity", "dividend_yield", "beta", "tech_rsi_14", "tech_change_1m_pct", "tech_change_3m_pct",
    "tech_change_1y_pct", "tech_volatility_ann", "tech_max_drawdown_1y", "tech_rel_strength_3m",
    "pct_from_52w_high", "target_upside_pct", "analyst_recommendation", "tech_trend",
]


def _normalised_series(symbol: str) -> list[dict]:
    hist = get_history(symbol, "1y")
    if hist.empty:
        return []
    close = hist["Close"]
    base = float(close.iloc[0])
    return [{"time": ts.strftime("%Y-%m-%d"), "value": round(float(v) / base * 100, 2)} for ts, v in close.items()]


def compare_stocks(symbols: list[str]) -> dict:
    symbols = list(dict.fromkeys(symbols))[:4]
    if len(symbols) < 2:
        raise ValueError("Pick at least two different stocks to compare.")
    with ThreadPoolExecutor(max_workers=4) as pool:
        datas = list(pool.map(fetch_stock_data, symbols))
        series = list(pool.map(_normalised_series, symbols))

    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a portfolio manager comparing Indian stocks head to head for a long-term investor.
Weigh quality, growth, valuation, balance sheet, momentum and risk. Cite specific numbers.
Score each 0-10, list strengths/weaknesses and who it suits, and pick ONE winner (use its exact symbol).
This is educational research, not personalised advice."""),
        ("human", "{blocks}"),
    ])
    blocks = "\n\n".join(format_for_agent(d) for d in datas)
    verdict = invoke_with_retry(prompt | structured(CompareVerdict, temperature=0.2), {"blocks": blocks},
                                schema=CompareVerdict).model_dump()
    if verdict["winner"] not in symbols:
        best = max(verdict["entries"], key=lambda e: e["score"], default=None)
        verdict["winner"] = best["symbol"] if best else symbols[0]

    return {
        "symbols": symbols,
        "stocks":  [{"symbol": d["symbol"], "name": d["name"], "sector": d["sector"],
                     **{k: d.get(k) for k in COMPARE_FIELDS}} for d in datas],
        "performance": {s: ser for s, ser in zip(symbols, series)},
        "verdict": verdict,
    }
