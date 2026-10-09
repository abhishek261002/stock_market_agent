# =============================================================================
# agents/bear_agent.py
# =============================================================================
# THE BEAR AGENT — argues the BEARISH case for a stock across one or more
# debate rounds. Mirror image of bull_agent.py; see agents/debater.py.
# =============================================================================

from dotenv import load_dotenv

from agents.debater import create_debater, run_debater

load_dotenv()

BEAR_PERSONA = """You are a sharp, sceptical BEARISH equity analyst specialising in Indian markets (NSE/BSE).
You are one side of a structured debate; a Bull analyst argues the opposite and a Judge decides.
Build the STRONGEST evidence-based case AGAINST owning this stock right now:
overvaluation, weakening growth or margins, balance-sheet risk, poor momentum, negative news,
sector headwinds, governance or concentration risk.
Rules:
- Every point must cite a specific number from the data or analyst reports
- Sceptical but fair — no fear-mongering, no invented facts
- Confidence is on a 0-10 scale reflecting how strong the bearish case genuinely is"""


def create_bear_agent():
    return create_debater(BEAR_PERSONA, temperature=0.4)


def run_bear_analysis(stock_data_text: str, analyst_brief: str = "No specialist reports available.",
                      round_no: int = 1, max_rounds: int = 1, opponent: str = "(none yet)",
                      own_previous: str = "(none — this is your first argument)") -> dict:
    print(f"\n[BearAgent] Round {round_no}: building bearish case...")
    result = run_debater(BEAR_PERSONA, stock_data_text, analyst_brief, round_no, max_rounds,
                         opponent, own_previous)
    print(f"[BearAgent] Round {round_no} done (confidence {result['confidence']}/10).")
    return result
