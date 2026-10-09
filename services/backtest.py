# =============================================================================
# services/backtest.py
# =============================================================================
# THE BACKTESTER — "would the AI's calls have made money?"
#
# For N evaluation dates spaced `horizon` trading days apart:
#   1. Slice price history up to that date (no future data)
#   2. Compute the technical snapshot as it looked THAT day
#   3. Ask an LLM agent for a BUY/HOLD/SELL call on that data alone
#   4. Measure the stock's forward return over `horizon` days vs NIFTY 50
# Then compare three strategies: AI agent, a rule-based SMA/RSI baseline and
# plain buy-and-hold — with hit rates and compounded equity curves.
#
# HONEST CAVEATS (also shown in the UI):
#   - Fundamentals/news aren't available point-in-time from Yahoo, so the
#     backtest agent sees price/technical data only.
#   - LLMs have training-data knowledge of past prices, so some look-ahead
#     bias is impossible to rule out. Treat results as indicative.
# =============================================================================

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Optional

import pandas as pd
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import QuickCall
from data.fetcher import get_history
from data.technicals import compute_snapshot, rule_signal
from data.universe import BENCHMARK

HOLD_BAND_PCT = 3.0   # a HOLD is "right" if the stock stays within ±3% of the index
MIN_LOOKBACK = 200    # need 200 bars for the 200-day SMA


def create_backtest_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a disciplined swing-trading analyst for Indian equities.
It is {date}. You only know the technical data below — do not use any knowledge of what happened
after this date. Decide BUY / HOLD / SELL for the next ~{horizon} trading days relative to the NIFTY 50.
Be decisive; HOLD only when signals genuinely conflict."""),
        ("human", "{data}"),
    ])
    return prompt | structured(QuickCall, temperature=0.1)


def _point_text(symbol: str, date: str, price: float, snap: dict) -> str:
    def f(k, s=""):
        v = snap.get(k)
        return "N/A" if v is None else f"{v}{s}"
    return (f"Stock: {symbol} | Date: {date} | Close: ₹{price:,.2f}\n"
            f"Trend: {snap.get('trend')} | SMA20/50/200: {f('sma_20')} / {f('sma_50')} / {f('sma_200')}\n"
            f"RSI14: {f('rsi_14')} | MACD: {f('macd_state')} (hist {f('macd_hist')})\n"
            f"Bollinger position: {f('bb_position_pct', '%')} | ATR: {f('atr_pct', '% of price')}\n"
            f"Returns 1W/1M/3M/6M: {f('change_1w_pct', '%')} / {f('change_1m_pct', '%')} / "
            f"{f('change_3m_pct', '%')} / {f('change_6m_pct', '%')}\n"
            f"Relative strength vs NIFTY (3M): {f('rel_strength_3m', ' pp')} | Volatility: {f('volatility_ann', '%')}")


def _correct(call: str, excess: float) -> bool:
    if call == "BUY":
        return excess > 0
    if call == "SELL":
        return excess < 0
    return abs(excess) <= HOLD_BAND_PCT


def _equity(returns: list[float]) -> list[float]:
    eq, out = 100.0, []
    for r in returns:
        eq *= 1 + r / 100
        out.append(round(eq, 2))
    return out


def run_backtest(symbol: str, points: int = 10, horizon: int = 21,
                 progress: Optional[Callable[[dict], None]] = None) -> dict:
    points = max(3, min(int(points), 24))
    horizon = max(5, min(int(horizon), 63))

    hist = get_history(symbol, "2y")
    if hist.empty:
        raise ValueError(f"No price history for {symbol}")
    bench = get_history(BENCHMARK, "2y")["Close"]
    close = hist["Close"]

    last_eval = len(hist) - 1 - horizon
    idxs = [last_eval - i * horizon for i in range(points)]
    idxs = sorted(i for i in idxs if i >= MIN_LOOKBACK)
    if len(idxs) < 3:
        raise ValueError(f"Not enough history for {symbol} to backtest (need ~{MIN_LOOKBACK + 3 * horizon} days)")

    def prep(i: int) -> dict:
        date = hist.index[i]
        sub = hist.iloc[: i + 1]
        b_sub = bench[bench.index <= date]
        snap = compute_snapshot(sub, b_sub)
        price = float(close.iloc[i])
        fwd_price = float(close.iloc[i + horizon])
        fwd_date = hist.index[i + horizon]
        b0, b1 = bench.asof(date), bench.asof(fwd_date)
        stock_ret = (fwd_price - price) / price * 100
        bench_ret = (b1 - b0) / b0 * 100 if pd.notna(b0) and pd.notna(b1) and b0 else 0.0
        return {
            "date": date.strftime("%Y-%m-%d"), "exit_date": fwd_date.strftime("%Y-%m-%d"),
            "price": round(price, 2), "exit_price": round(fwd_price, 2),
            "fwd_return_pct": round(stock_ret, 2), "bench_return_pct": round(bench_ret, 2),
            "excess_pct": round(stock_ret - bench_ret, 2),
            "rule_call": rule_signal(snap, price), "rsi": snap.get("rsi_14"), "trend": snap.get("trend"),
            "_text": _point_text(symbol, date.strftime("%d %b %Y"), price, snap),
        }

    rows = [prep(i) for i in idxs]
    chain = create_backtest_agent()

    def ask(row: dict) -> dict:
        try:
            call = invoke_with_retry(chain, {"date": row["date"], "horizon": horizon, "data": row["_text"]},
                                     schema=QuickCall)
            return {"ai_call": call.verdict, "ai_confidence": call.confidence, "ai_rationale": call.rationale}
        except Exception as e:
            return {"ai_call": "HOLD", "ai_confidence": 0, "ai_rationale": f"Call failed: {e}"}

    done = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(ask, r): r for r in rows}
        for f in as_completed(futures):
            futures[f].update(f.result())
            done += 1
            if progress:
                r = futures[f]
                progress({"done": done, "total": len(rows), "date": r["date"], "call": r["ai_call"]})

    for r in rows:
        r.pop("_text", None)
        r["ai_correct"] = _correct(r["ai_call"], r["excess_pct"])
        r["rule_correct"] = _correct(r["rule_call"], r["excess_pct"])

    ai_rets = [r["fwd_return_pct"] if r["ai_call"] == "BUY" else 0.0 for r in rows]
    rule_rets = [r["fwd_return_pct"] if r["rule_call"] == "BUY" else 0.0 for r in rows]
    bh_rets = [r["fwd_return_pct"] for r in rows]
    bench_rets = [r["bench_return_pct"] for r in rows]
    curves = {"ai": _equity(ai_rets), "rule": _equity(rule_rets),
              "buy_hold": _equity(bh_rets), "nifty": _equity(bench_rets)}

    def avg(xs):
        return round(sum(xs) / len(xs), 2) if xs else None

    buys = [r for r in rows if r["ai_call"] == "BUY"]
    sells = [r for r in rows if r["ai_call"] == "SELL"]
    metrics = {
        "points":                len(rows),
        "ai_hit_rate":           round(sum(r["ai_correct"] for r in rows) / len(rows) * 100, 1),
        "rule_hit_rate":         round(sum(r["rule_correct"] for r in rows) / len(rows) * 100, 1),
        "ai_total_return":       round(curves["ai"][-1] - 100, 2),
        "rule_total_return":     round(curves["rule"][-1] - 100, 2),
        "buy_hold_return":       round(curves["buy_hold"][-1] - 100, 2),
        "nifty_return":          round(curves["nifty"][-1] - 100, 2),
        "avg_excess_on_buy":     avg([r["excess_pct"] for r in buys]),
        "avg_excess_on_sell":    avg([r["excess_pct"] for r in sells]),
        "calls":                 {c: sum(1 for r in rows if r["ai_call"] == c) for c in ("BUY", "HOLD", "SELL")},
    }
    return {
        "symbol": symbol, "horizon_days": horizon, "rows": rows,
        "equity": [{"date": r["exit_date"], **{k: v[i] for k, v in curves.items()}} for i, r in enumerate(rows)],
        "metrics": metrics,
        "caveats": [
            "The backtest agent sees point-in-time price & technical data only (no fundamentals or news).",
            "LLMs may carry training-data knowledge of past prices, so look-ahead bias cannot be fully excluded.",
            "Strategy returns ignore costs, taxes and slippage; strategies are long-only (SELL/HOLD = cash).",
        ],
    }
