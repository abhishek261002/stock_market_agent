# =============================================================================
# agents/technical_agent.py
# =============================================================================
# THE TECHNICAL ANALYST — interprets trend, momentum, volatility and relative
# strength (all pre-computed in data/technicals.py; the LLM never does maths).
# =============================================================================

from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import AnalystReport

load_dotenv()


def create_technical_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a disciplined technical analyst for Indian equities.
Interpret ONLY the pre-computed indicators provided — never invent levels:
- Trend structure: price vs SMA 20/50/200, golden/death-cross state
- Momentum: RSI(14) zones (>70 overbought, <30 oversold), MACD vs signal
- Volatility & risk: ATR, annualised volatility, max drawdown, Bollinger position
- Relative strength vs NIFTY 50 over 3 months, distance from 52-week high/low
- Volume confirmation: volume ratio vs 20-day average
Identify the most relevant support/resistance from the SMAs, 52W levels and Bollinger bands.
Be objective. Cite exact numbers."""),
        ("human", """STOCK DATA:
{stock_data}

Produce your technical report."""),
    ])
    return prompt | structured(AnalystReport, temperature=0.2)


def run_technical_analysis(stock_data_text: str) -> dict:
    print("\n[TechnicalAgent] Analysing technicals...")
    chain = create_technical_agent()
    result = invoke_with_retry(chain, {"stock_data": stock_data_text}, schema=AnalystReport)
    print("[TechnicalAgent] Done.")
    return result.model_dump()
