# =============================================================================
# agents/fundamentals_agent.py
# =============================================================================
# THE FUNDAMENTALS ANALYST — reads valuation, profitability, balance sheet,
# quarterly trend and peer comparison, and returns a structured AnalystReport.
# Runs in parallel with the technical and news analysts.
# =============================================================================

from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import AnalystReport

load_dotenv()


def create_fundamentals_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a meticulous fundamentals analyst covering Indian equities (NSE/BSE).
Assess business quality and valuation strictly from the data provided:
- Valuation: P/E, forward P/E, PEG, P/B, EV/EBITDA — cheap or expensive vs peers and vs its own growth?
- Profitability: ROE, ROA, margins and their quarterly trend
- Growth: revenue and earnings growth, direction of the last few quarters
- Balance sheet: debt-to-equity, current ratio
- Ownership & street view: insider/institution holding, analyst targets
Always compare against the peer table when available. Cite specific numbers.
Be objective — you are NOT a bull or a bear. If data is missing, say so in red_flags.
Note: financial statements may be reported in a non-INR currency; compare ratios, not absolute sizes."""),
        ("human", """STOCK DATA:
{stock_data}

QUARTERLY FINANCIALS:
{financials}

SECTOR PEERS:
{peers}

Produce your fundamentals report."""),
    ])
    return prompt | structured(AnalystReport, temperature=0.2)


def run_fundamentals_analysis(stock_data_text: str, financials_text: str, peers_text: str) -> dict:
    print("\n[FundamentalsAgent] Analysing fundamentals...")
    chain = create_fundamentals_agent()
    result = invoke_with_retry(chain, {
        "stock_data": stock_data_text,
        "financials": financials_text,
        "peers":      peers_text,
    }, schema=AnalystReport)
    print("[FundamentalsAgent] Done.")
    return result.model_dump()
