# =============================================================================
# agents/news_agent.py
# =============================================================================
# THE NEWS & SENTIMENT ANALYST — a TOOL-USING agent.
#
# Phase 1 (plan):    the LLM reviews the seeded company headlines and decides
#                    which extra searches to run with the `search_news` tool
#                    (sector tailwinds, regulation, competitors, management...).
# Phase 2 (act):     we execute those tool calls.
# Phase 3 (judge):   every collected headline is numbered and the LLM returns
#                    a structured NewsReport scoring each one.
#
# WHY A "PLAN" CALL INSTEAD OF A MULTI-TURN TOOL LOOP?
# Gemini 3 models require a `thought_signature` to be echoed back with every
# function-call turn; the pinned langchain-google-genai (2.0.x, required by
# this LangGraph version) can't round-trip it, so multi-turn bind_tools fails
# with a 400. Planning the tool calls in one structured response is the
# plan-and-execute agent pattern — same autonomy, fewer LLM calls (which also
# matters on the free tier's 5 requests/minute).
# =============================================================================

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate

from agents.llm import invoke_with_retry, structured
from agents.schemas import NewsReport, ResearchPlan
from data.news import company_query, search_news

load_dotenv()

MAX_TOOL_CALLS = 2
MAX_HEADLINES = 20

TOOLS_DESCRIPTION = """search_news(query: str) — searches recent Indian business news (Google News, India edition).
Use specific queries, e.g. '<company> order win', '<sector> India regulation', '<competitor> quarterly results'."""


def create_research_planner():
    prompt = ChatPromptTemplate.from_messages([
        ("system", f"""You are a financial news researcher. You already have the company's latest headlines.
You have one tool:
{TOOLS_DESCRIPTION}
Plan at most {MAX_TOOL_CALLS} additional searches that would materially change an investment view
(sector tailwinds/headwinds, regulation, competitors, management, large orders, litigation).
Return an empty list if the existing headlines are sufficient. Do not repeat the existing search."""),
        ("human", "Company: {name} ({symbol}), sector: {sector}.\nAlready searched: \"{seed_query}\"\n"
                  "Existing headlines:\n{headlines}"),
    ])
    return prompt | structured(ResearchPlan, temperature=0.2)


def _research(name: str, symbol: str, sector: str, seed: list[dict]) -> tuple[list[dict], list[str], str]:
    """Lets the LLM choose extra news searches. Returns (headlines, queries_run, reason)."""
    seed_query = company_query(name, symbol)
    collected: list[dict] = list(seed)
    queries = [seed_query]
    seed_text = "\n".join(f"- {i['title']} ({i['source']})" for i in seed[:10]) or "No headlines found."
    try:
        plan = invoke_with_retry(create_research_planner(), {
            "name": name, "symbol": symbol, "sector": sector, "seed_query": seed_query, "headlines": seed_text,
        }, attempts=2, schema=ResearchPlan)
    except Exception as e:   # research is a bonus — never fail the analyst over it
        print(f"[NewsAgent] research planning failed: {e}")
        return collected, queries, ""

    for q in [q.strip() for q in plan.queries if q.strip()][:MAX_TOOL_CALLS]:
        if q.lower() == seed_query.lower():
            continue
        collected.extend(search_news(q, 8))   # ← the tool call
        queries.append(q)
    return collected, queries, plan.reason


def _dedupe(items: list[dict]) -> list[dict]:
    seen, out = set(), []
    for i in items:
        k = i["title"].lower()[:80]
        if k not in seen:
            seen.add(k)
            out.append(i)
    return out


def create_news_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a news & sentiment analyst for Indian equities.
Score each numbered headline's sentiment for THIS stock's shareholders and its likely price impact.
Market-wide headlines that merely mention the company are low impact.
Then summarise: overall stance, a 0-10 bullishness score, aggregate sentiment (-1..1),
recurring themes, key points and red flags. If there is little relevant news, say so and stay neutral."""),
        ("human", """Company: {name} ({symbol})

HEADLINES:
{headlines}

Produce your news report."""),
    ])
    return prompt | structured(NewsReport, temperature=0.1)


def run_news_analysis(name: str, symbol: str, sector: str = "N/A") -> dict:
    print("\n[NewsAgent] Researching news...")
    seed = search_news(company_query(name, symbol), 12)
    collected, queries, reason = _research(name, symbol, sector, seed)
    headlines = _dedupe(collected)[:MAX_HEADLINES]

    numbered = "\n".join(
        f"[{i}] {h['title']} — {h['source']} ({(h.get('published') or '')[:10]})"
        for i, h in enumerate(headlines)
    ) or "No headlines found."

    report = invoke_with_retry(create_news_agent(), {
        "name": name, "symbol": symbol, "headlines": numbered,
    }, schema=NewsReport).model_dump()

    scored = {h["index"]: h for h in report.pop("headlines", [])}
    report["headlines"] = [
        {**h, "sentiment": scored.get(i, {}).get("sentiment", "neutral"),
              "impact":    scored.get(i, {}).get("impact", "low")}
        for i, h in enumerate(headlines)
    ]
    report["searches"] = queries
    report["research_reason"] = reason
    print(f"[NewsAgent] Done. {len(headlines)} headlines, {len(queries)} searches.")
    return report
