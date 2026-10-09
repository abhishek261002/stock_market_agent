# =============================================================================
# agents/judge_agent.py
# =============================================================================
# THE JUDGE AGENT — weighs the full multi-round debate plus the specialist
# reports and returns a structured Verdict (BUY/HOLD/SELL, confidence, risks...).
#
# MEMORY: the judge also sees its own previous calls on this stock (from the
# SQLite history) so it can explain when and why its view has changed.
# =============================================================================

from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import Verdict

load_dotenv()


def create_judge_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a decisive, senior portfolio manager at a top Indian asset management firm.
You have specialist analyst reports and a multi-round debate between a Bull and a Bear analyst.

DECISIVENESS RULE (most important) — use each side's FINAL-round confidence:
- Bull final confidence exceeds Bear's by 1.5 or more → verdict MUST be BUY
- Bear final confidence exceeds Bull's by 1.5 or more → verdict MUST be SELL
- Only give HOLD if both are within 1.5 points AND the data is genuinely mixed
- Never give HOLD just to play it safe. Pick a side when the data supports it.
You may override the rule only if one side's argument relied on factually wrong numbers — say so explicitly.

Also judge argument QUALITY: who rebutted better, who conceded fairly, who cited real data.
If you have previous calls on this stock, state whether your view changed and why.
Your output is educational research, not personalised advice."""),
        ("human", """STOCK DATA:
{stock_data}

SPECIALIST ANALYST REPORTS:
{analyst_brief}

DEBATE TRANSCRIPT:
{debate}

FINAL CONFIDENCE — Bull: {bull_conf}/10, Bear: {bear_conf}/10

YOUR PREVIOUS CALLS ON THIS STOCK:
{prior_calls}

Deliver your verdict."""),
    ])
    return prompt | structured(Verdict, temperature=0.1)


def run_judge_analysis(stock_data_text: str, debate_text: str, analyst_brief: str = "No specialist reports available.",
                       bull_conf: float | None = None, bear_conf: float | None = None,
                       prior_calls: str = "None — first analysis of this stock.") -> dict:
    print("\n[JudgeAgent] Weighing arguments and delivering verdict...")
    result = invoke_with_retry(create_judge_agent(), {
        "stock_data":    stock_data_text,
        "analyst_brief": analyst_brief,
        "debate":        debate_text,
        "bull_conf":     "N/A" if bull_conf is None else bull_conf,
        "bear_conf":     "N/A" if bear_conf is None else bear_conf,
        "prior_calls":   prior_calls,
    }, schema=Verdict)
    print(f"[JudgeAgent] Verdict delivered: {result.verdict} ({result.confidence}/10).")
    return result.model_dump()
