# =============================================================================
# graph/state.py
# =============================================================================
# The shared state contract for the LangGraph pipeline.
#
# REDUCERS: fields written by nodes that run IN PARALLEL need a reducer that
# says how to combine concurrent writes — otherwise LangGraph raises
# InvalidUpdateError. `Annotated[list, operator.add]` means "append".
# .NET ANALOGY: like ConcurrentDictionary.AddOrUpdate's merge function.
# =============================================================================

import operator
from typing import Annotated, Optional, TypedDict


def merge_dicts(left: Optional[dict], right: Optional[dict]) -> dict:
    return {**(left or {}), **(right or {})}


class AgentState(TypedDict, total=False):
    """
    Written by:
      symbol, max_rounds, prior_calls → caller, at graph entry
      stock_data, stock_data_text,
      financials, peers               → fetch_data
      analyst_reports                 → fundamentals / technical / news (parallel, merged)
      debate                          → bull / bear each round (parallel, appended)
      round                           → round_end (number of completed rounds)
      final_verdict                   → judge
      risk_plan                       → risk
      warnings                        → any node, non-fatal (appended)
      error                           → fetch_data, fatal (graph ends early)
    """

    # --- Input ---
    symbol: str
    max_rounds: int
    prior_calls: str

    # --- Data ---
    stock_data: Optional[dict]
    stock_data_text: Optional[str]
    financials: list
    peers: list

    # --- Specialists (parallel) ---
    analyst_reports: Annotated[dict, merge_dicts]

    # --- Debate (parallel, multi-round) ---
    debate: Annotated[list, operator.add]   # [{"side", "round", "argument"}]
    round: int

    # --- Decision ---
    final_verdict: Optional[dict]
    risk_plan: Optional[dict]

    # --- Errors ---
    warnings: Annotated[list, operator.add]
    error: Optional[str]
