# =============================================================================
# agents/debater.py
# =============================================================================
# Shared machinery for the Bull and Bear debaters. Each side supplies its own
# persona; this module builds the multi-round prompt:
#   round 1   → opening argument (no rebuttal)
#   round 2+  → must directly rebut the opponent's latest argument, may concede
#               a point, and should update confidence honestly.
# =============================================================================

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import DebateArgument

_HUMAN = """STOCK DATA:
{stock_data}

SPECIALIST ANALYST REPORTS:
{analyst_brief}

DEBATE ROUND {round} of up to {max_rounds}.

YOUR PREVIOUS ARGUMENT:
{own_previous}

OPPONENT'S LATEST ARGUMENT:
{opponent}

{instruction}"""

_OPENING = "This is the OPENING round. Make your strongest case. Set rebuttal to null."
_REBUTTAL = ("This is a REBUTTAL round. Directly counter the opponent's specific claims with numbers, "
             "add any new evidence, and concede a point if it is genuinely fair. Adjust your confidence "
             "honestly; lowering it when the opponent lands a blow is a sign of credibility, not weakness. "
             "Do not repeat your previous points verbatim.")


def create_debater(persona: str, temperature: float = 0.4):
    prompt = ChatPromptTemplate.from_messages([("system", persona), ("human", _HUMAN)])
    return prompt | structured(DebateArgument, temperature=temperature)


def run_debater(persona: str, stock_data_text: str, analyst_brief: str = "No specialist reports available.",
                round_no: int = 1, max_rounds: int = 1, opponent: str = "(none yet)",
                own_previous: str = "(none — this is your first argument)", temperature: float = 0.4) -> dict:
    chain = create_debater(persona, temperature)
    result = invoke_with_retry(chain, {
        "stock_data":    stock_data_text,
        "analyst_brief": analyst_brief,
        "round":         round_no,
        "max_rounds":    max_rounds,
        "opponent":      opponent,
        "own_previous":  own_previous,
        "instruction":   _OPENING if round_no == 1 else _REBUTTAL,
    }, schema=DebateArgument)
    out = result.model_dump()
    if round_no == 1:
        out["rebuttal"] = None
    return out
