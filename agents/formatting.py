# =============================================================================
# agents/formatting.py
# =============================================================================
# Turns structured agent outputs (dicts) back into compact text so the next
# agent in the graph can read them in its prompt.
# =============================================================================

from __future__ import annotations

ANALYST_LABELS = {
    "fundamentals": "FUNDAMENTALS ANALYST",
    "technical":    "TECHNICAL ANALYST",
    "news":         "NEWS & SENTIMENT ANALYST",
}


def format_analyst_brief(reports: dict) -> str:
    if not reports:
        return "No specialist reports available."
    blocks = []
    for key in ("fundamentals", "technical", "news"):
        r = reports.get(key)
        if not r:
            continue
        lines = [
            f"[{ANALYST_LABELS[key]}] stance={r.get('stance')} score={r.get('score')}/10",
            f"Headline: {r.get('headline', '')}",
            f"Summary: {r.get('summary', '')}",
        ]
        for p in r.get("key_points", []):
            lines.append(f"  + {p}")
        for f in r.get("red_flags", []):
            lines.append(f"  ! {f}")
        if key == "news" and r.get("sentiment_score") is not None:
            lines.append(f"  News sentiment: {r['sentiment_score']:+.2f} (-1..+1); themes: {', '.join(r.get('themes', []))}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def format_argument(arg: dict | None) -> str:
    if not arg:
        return "(none)"
    lines = [f"Thesis: {arg.get('thesis', '')}"]
    for p in arg.get("points", []):
        lines.append(f"- {p.get('title')}: {p.get('detail')}")
    if arg.get("rebuttal"):
        lines.append(f"Rebuttal: {arg['rebuttal']}")
    if arg.get("concession"):
        lines.append(f"Concedes: {arg['concession']}")
    lines.append(f"Confidence: {arg.get('confidence')}/10")
    return "\n".join(lines)


def format_debate_transcript(debate: list[dict]) -> str:
    if not debate:
        return "(no debate)"
    ordered = sorted(debate, key=lambda e: (e["round"], 0 if e["side"] == "bull" else 1))
    return "\n\n".join(
        f"--- ROUND {e['round']} · {e['side'].upper()} ---\n{format_argument(e['argument'])}"
        for e in ordered
    )


def latest_argument(debate: list[dict], side: str) -> dict | None:
    mine = [e for e in debate if e["side"] == side]
    return max(mine, key=lambda e: e["round"])["argument"] if mine else None
