# =============================================================================
# graph/pipeline.py
# =============================================================================
# THE LANGGRAPH PIPELINE — the single analysis engine used by both the CLI
# (main.py) and the API (api/main.py).
#
#                         ┌─ fundamentals ─┐
#   START → fetch_data ───┼─ technical ────┼─→ debate_start ─┬─ bull ─┐
#             │           └─ news (tools) ─┘                 └─ bear ─┴→ round_end
#             └─(error)→ END                        ▲                       │
#                                                   └──── next round ◄──────┤
#                                                                           ▼
#                                                          judge → risk → END
#
# NEW CONCEPTS vs the original linear graph:
#   Fan-out / fan-in  → one node with edges to several nodes runs them in
#                       PARALLEL; add_edge([a, b, c], d) waits for all of them.
#   Conditional edges → add_conditional_edges(node, router) where router(state)
#                       returns the next node name(s). Used for early exit on
#                       fetch errors and for the debate loop.
#   Cycles            → round_end can route back to bull/bear: a real loop.
#
# PROGRESS EVENTS: callers pass config={"configurable": {"emit": fn}}; every
# node calls fn({...}) as it starts/finishes so the UI can animate live.
# .NET ANALOGY: IProgress<T> passed into a Durable Functions orchestration.
# =============================================================================

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from agents.bear_agent import run_bear_analysis
from agents.bull_agent import run_bull_analysis
from agents.formatting import (format_analyst_brief, format_argument,
                               format_debate_transcript, latest_argument)
from agents.fundamentals_agent import run_fundamentals_analysis
from agents.judge_agent import run_judge_analysis
from agents.llm import on_wait
from agents.news_agent import run_news_analysis
from agents.risk_agent import run_risk_analysis
from agents.technical_agent import run_technical_analysis
from config import DEBATE_ROUNDS, MAX_DEBATE_ROUNDS
from data.fetcher import (fetch_stock_data, format_financials_for_agent, format_for_agent,
                          format_peers_for_agent, get_peer_snapshots, get_quarterly_financials)
from graph.state import AgentState

CONVERGENCE_DELTA = 0.5   # stop debating early if neither side moves more than this


# =============================================================================
# EVENT HELPERS
# =============================================================================

def _emit(config: Optional[RunnableConfig], **event) -> None:
    emitter = ((config or {}).get("configurable") or {}).get("emit")
    if emitter:
        try:
            emitter(event)
        except Exception as e:  # a broken UI stream must never kill the analysis
            print(f"[Pipeline] emit failed: {e}")


def _timed(config, stage: str, fn: Callable, **extra):
    _emit(config, type="stage", stage=stage, status="running", **extra)
    t0 = time.time()
    # Report rate-limit waits for this stage to the UI ("waiting 23s for a Gemini slot")
    token = on_wait.set(lambda secs: _emit(config, type="throttle", stage=stage, wait=secs, **extra))
    try:
        result = fn()
    finally:
        on_wait.reset(token)
    _emit(config, type="stage", stage=stage, status="done", payload=result,
          elapsed=round(time.time() - t0, 1), **extra)
    return result


def _fallback_report(name: str, err: Exception) -> dict:
    return {
        "stance": "neutral", "score": 5.0, "headline": f"{name} analysis unavailable",
        "summary": f"This analyst could not complete its work ({err}). Treat as neutral.",
        "key_points": [], "red_flags": ["Analysis unavailable"], "failed": True,
    }


# =============================================================================
# NODES
# =============================================================================

def fetch_data_node(state: AgentState, config: RunnableConfig) -> dict:
    symbol = state["symbol"]
    _emit(config, type="stage", stage="fetch_data", status="running")
    t0 = time.time()
    try:
        stock_data = fetch_stock_data(symbol)
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_fin = pool.submit(get_quarterly_financials, symbol)
            f_peers = pool.submit(get_peer_snapshots, symbol)
            financials, peers = f_fin.result(), f_peers.result()
    except Exception as e:
        print(f"[fetch_data_node] ERROR: {e}")
        _emit(config, type="stage", stage="fetch_data", status="error", message=str(e))
        return {"error": str(e)}

    _emit(config, type="stage", stage="fetch_data", status="done",
          payload={"name": stock_data["name"], "price": stock_data["current_price"],
                   "change_1d_pct": stock_data.get("change_1d_pct"), "peers": len(peers),
                   "quarters": len(financials)},
          elapsed=round(time.time() - t0, 1))
    return {
        "stock_data":      stock_data,
        "stock_data_text": format_for_agent(stock_data),
        "financials":      financials,
        "peers":           peers,
    }


def _analyst_node(key: str, label: str, work: Callable[[AgentState], dict]):
    def node(state: AgentState, config: RunnableConfig) -> dict:
        try:
            report = _timed(config, key, lambda: work(state))
            return {"analyst_reports": {key: report}}
        except Exception as e:
            print(f"[{key}_node] ERROR: {e}")
            report = _fallback_report(label, e)
            _emit(config, type="stage", stage=key, status="error", payload=report, message=str(e))
            return {"analyst_reports": {key: report}, "warnings": [f"{label}: {e}"]}
    node.__name__ = f"{key}_node"
    return node


fundamentals_node = _analyst_node("fundamentals", "Fundamentals", lambda s: run_fundamentals_analysis(
    s["stock_data_text"],
    format_financials_for_agent(s.get("financials") or [], (s.get("stock_data") or {}).get("financial_currency", "INR")),
    format_peers_for_agent(s.get("peers") or []),
))

technical_node = _analyst_node("technical", "Technical", lambda s: run_technical_analysis(s["stock_data_text"]))

news_node = _analyst_node("news", "News", lambda s: run_news_analysis(
    s["stock_data"]["name"], s["symbol"], s["stock_data"].get("sector", "N/A"),
))


def debate_start_node(state: AgentState, config: RunnableConfig) -> dict:
    """Join point after the parallel analysts; also announces the debate."""
    _emit(config, type="debate_start", max_rounds=state.get("max_rounds", DEBATE_ROUNDS))
    return {"round": 0}


def _debater_node(side: str, run: Callable):
    other = "bear" if side == "bull" else "bull"

    def node(state: AgentState, config: RunnableConfig) -> dict:
        round_no = state.get("round", 0) + 1
        debate = state.get("debate") or []
        opponent = latest_argument(debate, other)
        own = latest_argument(debate, side)
        argument = _timed(config, side, lambda: run(
            state["stock_data_text"],
            format_analyst_brief(state.get("analyst_reports") or {}),
            round_no,
            state.get("max_rounds", DEBATE_ROUNDS),
            format_argument(opponent) if opponent else "(none yet)",
            format_argument(own) if own else "(none — this is your first argument)",
        ), round=round_no)
        return {"debate": [{"side": side, "round": round_no, "argument": argument}]}

    node.__name__ = f"{side}_node"
    return node


bull_node = _debater_node("bull", run_bull_analysis)
bear_node = _debater_node("bear", run_bear_analysis)


def round_end_node(state: AgentState, config: RunnableConfig) -> dict:
    completed = state.get("round", 0) + 1
    debate = state.get("debate") or []
    this_round = {e["side"]: e["argument"]["confidence"] for e in debate if e["round"] == completed}
    _emit(config, type="round_end", round=completed,
          bull_confidence=this_round.get("bull"), bear_confidence=this_round.get("bear"))
    return {"round": completed}


def route_after_fetch(state: AgentState):
    if state.get("error"):
        return END
    return ["fundamentals", "technical", "news"]


def route_after_round(state: AgentState):
    completed = state.get("round", 0)
    max_rounds = state.get("max_rounds", DEBATE_ROUNDS)
    if completed >= max_rounds:
        return "judge"
    if completed >= 2:
        debate = state.get("debate") or []
        conf = {(e["side"], e["round"]): e["argument"]["confidence"] for e in debate}
        moved = [abs(conf.get((s, completed), 0) - conf.get((s, completed - 1), 0)) for s in ("bull", "bear")]
        if max(moved) < CONVERGENCE_DELTA:
            print(f"[Pipeline] Debate converged after round {completed}.")
            return "judge"
    return ["bull", "bear"]


def judge_node(state: AgentState, config: RunnableConfig) -> dict:
    debate = state.get("debate") or []
    bull = latest_argument(debate, "bull") or {}
    bear = latest_argument(debate, "bear") or {}
    verdict = _timed(config, "judge", lambda: run_judge_analysis(
        state["stock_data_text"],
        format_debate_transcript(debate),
        format_analyst_brief(state.get("analyst_reports") or {}),
        bull.get("confidence"),
        bear.get("confidence"),
        state.get("prior_calls") or "None — first analysis of this stock.",
    ))
    return {"final_verdict": verdict}


def risk_node(state: AgentState, config: RunnableConfig) -> dict:
    try:
        plan = _timed(config, "risk", lambda: run_risk_analysis(
            state["stock_data"], state["stock_data_text"], state["final_verdict"]))
        return {"risk_plan": plan}
    except Exception as e:
        print(f"[risk_node] ERROR: {e}")
        _emit(config, type="stage", stage="risk", status="error", message=str(e))
        return {"warnings": [f"Risk: {e}"]}


# =============================================================================
# GRAPH BUILDER
# =============================================================================

def build_pipeline():
    """Builds and compiles the multi-agent debate graph. Call once, invoke many times."""
    graph = StateGraph(AgentState)

    graph.add_node("fetch_data",   fetch_data_node)
    graph.add_node("fundamentals", fundamentals_node)
    graph.add_node("technical",    technical_node)
    graph.add_node("news",         news_node)
    graph.add_node("debate_start", debate_start_node)
    graph.add_node("bull",         bull_node)
    graph.add_node("bear",         bear_node)
    graph.add_node("round_end",    round_end_node)
    graph.add_node("judge",        judge_node)
    graph.add_node("risk",         risk_node)

    graph.add_edge(START, "fetch_data")
    graph.add_conditional_edges("fetch_data", route_after_fetch,
                                ["fundamentals", "technical", "news", END])
    graph.add_edge(["fundamentals", "technical", "news"], "debate_start")   # fan-in
    graph.add_edge("debate_start", "bull")                                    # fan-out
    graph.add_edge("debate_start", "bear")
    graph.add_edge(["bull", "bear"], "round_end")                             # fan-in
    graph.add_conditional_edges("round_end", route_after_round, ["bull", "bear", "judge"])
    graph.add_edge("judge", "risk")
    graph.add_edge("risk", END)

    return graph.compile()


_compiled = None


def get_pipeline():
    global _compiled
    if _compiled is None:
        _compiled = build_pipeline()
    return _compiled


def run_analysis(symbol: str, max_rounds: int = DEBATE_ROUNDS, emit: Optional[Callable] = None,
                 prior_calls: str = "None — first analysis of this stock.") -> dict:
    """Runs the full pipeline synchronously and returns the final state."""
    rounds = max(1, min(MAX_DEBATE_ROUNDS, int(max_rounds)))
    return get_pipeline().invoke(
        {"symbol": symbol, "max_rounds": rounds, "prior_calls": prior_calls,
         "debate": [], "warnings": [], "analyst_reports": {}, "round": 0},
        config={"configurable": {"emit": emit}, "recursion_limit": 60},
    )
