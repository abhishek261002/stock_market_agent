# =============================================================================
# agents/risk_agent.py
# =============================================================================
# THE RISK MANAGER — turns the judge's verdict into a concrete trade plan.
#
# The NUMBERS (stop-loss, targets, position size) are computed deterministically
# from ATR/volatility in compute_risk_plan() — LLMs are bad at arithmetic and
# a risk plan must be reproducible. The LLM only adds commentary on top.
#
# Position sizing uses the classic fixed-fractional rule: risk 1% of capital
# per trade → size = 1% / stop-distance%, scaled by judge confidence, capped.
# =============================================================================

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import RiskCommentary

load_dotenv()

RISK_PER_TRADE_PCT = 1.0
MAX_POSITION_PCT = 20.0


def compute_risk_plan(stock_data: dict, verdict: dict) -> dict:
    price = float(stock_data["current_price"])
    atr = stock_data.get("tech_atr_14") or price * 0.02
    vol = stock_data.get("tech_volatility_ann")
    action = verdict.get("verdict", "HOLD")
    conf = float(verdict.get("confidence") or 5)

    if action == "SELL":
        stop = price + 2 * atr                      # stop for a short / re-entry trigger
        t1, t2 = price - 3 * atr, price - 6 * atr
    else:
        stop = price - (2.5 if action == "HOLD" else 2) * atr
        t1, t2 = price + 3 * atr, price + 6 * atr

    stop_dist_pct = abs(price - stop) / price * 100
    reward = abs(t1 - price)
    rr = round(reward / abs(price - stop), 2) if stop != price else None

    if action == "BUY":
        size = min(MAX_POSITION_PCT, RISK_PER_TRADE_PCT / (stop_dist_pct / 100)) * (conf / 10)
    elif action == "HOLD":
        size = min(MAX_POSITION_PCT, RISK_PER_TRADE_PCT / (stop_dist_pct / 100)) * 0.5 * (conf / 10)
    else:
        size = 0.0

    regime = "unknown" if vol is None else "low" if vol < 20 else "medium" if vol < 35 else "high"

    support = [v for v in (stock_data.get("tech_sma_50"), stock_data.get("tech_sma_200"),
                           stock_data.get("tech_bb_lower"), stock_data.get("week_52_low")) if v and v < price]
    resistance = [v for v in (stock_data.get("tech_sma_50"), stock_data.get("tech_sma_200"),
                              stock_data.get("tech_bb_upper"), stock_data.get("week_52_high")) if v and v > price]

    return {
        "action":             action,
        "entry":              round(price, 2),
        "stop_loss":          round(stop, 2),
        "stop_distance_pct":  round(stop_dist_pct, 2),
        "target_1":           round(max(t1, 0.01), 2),
        "target_2":           round(max(t2, 0.01), 2),
        "risk_reward":        rr,
        "position_size_pct":  round(size, 1),
        "volatility_regime":  regime,
        "atr":                round(atr, 2),
        "nearest_support":    round(max(support), 2) if support else None,
        "nearest_resistance": round(min(resistance), 2) if resistance else None,
        "analyst_target":     stock_data.get("target_price"),
        "method": (f"Stop = {'2.5' if action == 'HOLD' else '2'}×ATR, targets = 3×/6×ATR, "
                   f"size = {RISK_PER_TRADE_PCT:g}% capital risk ÷ stop distance × confidence, cap {MAX_POSITION_PCT:g}%"),
    }


def create_risk_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a risk manager at an Indian fund. You receive a verdict and a pre-computed,
ATR-based trade plan. Do NOT change the numbers. Add practical risk notes: whether the stop sits
sensibly relative to support/resistance, event risks (results, policy), liquidity/volatility
considerations and what would invalidate the thesis."""),
        ("human", """STOCK DATA:
{stock_data}

VERDICT: {verdict} ({confidence}/10) — {headline}
KEY RISKS: {risks}

TRADE PLAN:
{plan}

Write your risk notes."""),
    ])
    return prompt | structured(RiskCommentary, temperature=0.2)


def run_risk_analysis(stock_data: dict, stock_data_text: str, verdict: dict) -> dict:
    print("\n[RiskAgent] Building risk plan...")
    plan = compute_risk_plan(stock_data, verdict)
    try:
        commentary = invoke_with_retry(create_risk_agent(), {
            "stock_data": stock_data_text,
            "verdict":    verdict.get("verdict"),
            "confidence": verdict.get("confidence"),
            "headline":   verdict.get("headline", ""),
            "risks":      "; ".join(verdict.get("key_risks", [])),
            "plan":       "\n".join(f"{k}: {v}" for k, v in plan.items()),
        }, schema=RiskCommentary).model_dump()
    except Exception as e:  # numbers are still useful without commentary
        print(f"[RiskAgent] commentary failed: {e}")
        commentary = {"notes": [], "invalidation": ""}
    print("[RiskAgent] Done.")
    return {**plan, **commentary}
