# =============================================================================
# services/analysis.py
# =============================================================================
# Runs the LangGraph pipeline for one symbol, then persists the result:
#   - feeds the judge its own prior calls (memory)
#   - saves the analysis to history
#   - raises a verdict-flip alert if the stock is on the watchlist
# Used by the API (streaming), the scheduler and the CLI.
# =============================================================================

from __future__ import annotations

import time
from typing import Callable, Optional

from config import DEBATE_ROUNDS, DISCLAIMER
from graph.pipeline import run_analysis
from storage import db


def run_and_save(symbol: str, rounds: int = DEBATE_ROUNDS, emit: Optional[Callable] = None) -> dict:
    t0 = time.time()
    previous = db.latest_analysis(symbol)
    state = run_analysis(symbol, rounds, emit, prior_calls=db.prior_calls_text(symbol))
    if state.get("error"):
        raise ValueError(state["error"])

    result = {
        "symbol":          symbol,
        "rounds":          state.get("round"),
        "stock_data":      state.get("stock_data"),
        "financials":      state.get("financials") or [],
        "peers":           state.get("peers") or [],
        "analyst_reports": state.get("analyst_reports") or {},
        "debate":          sorted(state.get("debate") or [], key=lambda e: (e["round"], e["side"] != "bull")),
        "verdict":         state.get("final_verdict"),
        "risk_plan":       state.get("risk_plan"),
        "warnings":        state.get("warnings") or [],
        "previous":        previous,
        "duration_sec":    round(time.time() - t0, 1),
        "disclaimer":      DISCLAIMER,
    }
    db.save_analysis(result)
    v = result["verdict"] or {}
    db.check_verdict_flip(symbol, v.get("verdict"), v.get("confidence"), previous)
    return result
