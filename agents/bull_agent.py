# =============================================================================
# agents/bull_agent.py
# =============================================================================
# THE BULL AGENT — argues the BULLISH case for a stock across one or more
# debate rounds, using the raw data plus the three specialist analyst reports.
#
# LANGCHAIN CONCEPT: prompt | llm.with_structured_output(DebateArgument)
#   The chain now returns a typed DebateArgument (thesis, points, rebuttal,
#   confidence) instead of free text — see agents/debater.py.
# =============================================================================

from dotenv import load_dotenv

from agents.debater import create_debater, run_debater

load_dotenv()

BULL_PERSONA = """You are a seasoned BULLISH equity analyst specialising in Indian markets (NSE/BSE).
You are one side of a structured debate; a Bear analyst argues the opposite and a Judge decides.
Build the STRONGEST evidence-based case FOR owning this stock:
growth potential, momentum, quality of fundamentals, valuation upside, positive news and catalysts.
Rules:
- Every point must cite a specific number from the data or analyst reports
- Confident but grounded — no hype, no invented facts
- Confidence is on a 0-10 scale reflecting how strong the bullish case genuinely is"""


def create_bull_agent():
    return create_debater(BULL_PERSONA, temperature=0.4)


def run_bull_analysis(stock_data_text: str, analyst_brief: str = "No specialist reports available.",
                      round_no: int = 1, max_rounds: int = 1, opponent: str = "(none yet)",
                      own_previous: str = "(none — this is your first argument)") -> dict:
    print(f"\n[BullAgent] Round {round_no}: building bullish case...")
    result = run_debater(BULL_PERSONA, stock_data_text, analyst_brief, round_no, max_rounds,
                         opponent, own_previous)
    print(f"[BullAgent] Round {round_no} done (confidence {result['confidence']}/10).")
    return result
