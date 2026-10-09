# =============================================================================
# services/chat.py
# =============================================================================
# Follow-up Q&A on a finished analysis ("why not SELL?", "what if results
# disappoint?"). The full analysis is injected as context; answers stream
# token-by-token. LANGCHAIN CONCEPT: llm.stream(messages) yields chunks.
# =============================================================================

from __future__ import annotations

from typing import Iterator

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from agents.formatting import format_analyst_brief, format_debate_transcript
from agents.llm import acquire_slot, get_llm, text_of
from data.fetcher import format_for_agent

MAX_HISTORY = 12


def build_context(analysis: dict) -> str:
    v = analysis.get("verdict") or {}
    risk = analysis.get("risk_plan") or {}
    return "\n\n".join([
        format_for_agent(analysis["stock_data"]),
        "SPECIALIST REPORTS:\n" + format_analyst_brief(analysis.get("analyst_reports") or {}),
        "DEBATE:\n" + format_debate_transcript(analysis.get("debate") or []),
        (f"JUDGE VERDICT: {v.get('verdict')} ({v.get('confidence')}/10) — {v.get('headline')}\n"
         f"Reasoning: {v.get('reasoning')}\nRisks: {'; '.join(v.get('key_risks', []))}\n"
         f"Action: {v.get('suggested_action')}"),
        (f"RISK PLAN: entry ₹{risk.get('entry')}, stop ₹{risk.get('stop_loss')}, targets ₹{risk.get('target_1')} / "
         f"₹{risk.get('target_2')}, size {risk.get('position_size_pct')}% of portfolio") if risk else "",
    ])


def stream_answer(analysis: dict, messages: list[dict]) -> Iterator[str]:
    system = SystemMessage(content=(
        "You are the Judge from a multi-agent stock debate, answering the investor's follow-up questions. "
        "Ground every answer in the analysis below; if something isn't covered, say so rather than guessing. "
        "Be concise (under 180 words), use short paragraphs or bullets, cite numbers. "
        "This is educational research, not personalised investment advice.\n\n"
        f"=== ANALYSIS ===\n{build_context(analysis)}"
    ))
    history = []
    for m in messages[-MAX_HISTORY:]:
        cls = HumanMessage if m.get("role") == "user" else AIMessage
        history.append(cls(content=str(m.get("content", ""))[:4000]))
    acquire_slot()
    for chunk in get_llm(0.3).stream([system, *history]):
        piece = text_of(chunk)
        if piece:
            yield piece
