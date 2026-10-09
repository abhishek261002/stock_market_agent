# =============================================================================
# agents/mock_llm.py
# =============================================================================
# A deterministic stand-in for Gemini that returns schema-valid outputs.
# Used by the test-suite, and by DEMO MODE (LLM_MOCK=1) so the UI can be
# developed/demoed without spending API quota. Adds realistic latency in demo.
# =============================================================================

from __future__ import annotations

import random
import time

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from agents import schemas as S

class FakeLLM:
    """Mimics the subset of ChatGoogleGenerativeAI the agents use.

    `bull_confidences` / `bear_confidences` let tests script the debate.
    """

    def __init__(self, temperature: float = 0.2, script: dict | None = None,
                 latency: tuple[float, float] | None = None):
        self.temperature = temperature
        self.script = script if script is not None else {}
        self.calls: list[str] = []
        self.latency = latency

    def _sleep(self, scale: float = 1.0):
        if self.latency:
            time.sleep(random.uniform(*self.latency) * scale)

    # --- structured output ---
    def with_structured_output(self, schema):
        def run(prompt_value):
            text = prompt_value.to_string() if hasattr(prompt_value, "to_string") else str(prompt_value)
            self.calls.append(schema.__name__)
            self._sleep()
            return self._build(schema, text)
        return RunnableLambda(run)

    def _build(self, schema, text: str):
        if schema is S.DebateArgument:
            side = "bull" if "BULLISH equity analyst" in text else "bear"
            seq = self.script.get(f"{side}_confidences", [7.0, 7.0, 7.0, 7.0])
            key = f"_{side}_i"
            i = self.script.get(key, 0)
            self.script[key] = i + 1
            bull = side == "bull"
            return S.DebateArgument(
                thesis=(f"{side.capitalize()} thesis: " + ("quality compounder at a fair price with improving momentum."
                                               if bull else "growth is slowing while the valuation still assumes perfection.")),
                confidence=seq[min(i, len(seq) - 1)],
                points=[
                    S.DebatePoint(title="Capital efficiency" if bull else "Valuation stretch",
                                  detail="ROE of 28% is notable versus a sector median near 18%." if bull else
                                  "P/E of 22.5x sits above the 5-year average with only 12% revenue growth."),
                    S.DebatePoint(title="Trend support" if bull else "Momentum fading",
                                  detail="Price holds above the 200-day average with RSI in a healthy 55-60 band." if bull else
                                  "MACD histogram is shrinking and volume on up-days is below the 20-day average."),
                    S.DebatePoint(title="Street upside" if bull else "Event risk",
                                  detail="Mean analyst target implies double-digit upside from here." if bull else
                                  "Upcoming results could reset guidance lower, as peers already did."),
                ],
                rebuttal=(("The bear ignores margins expanding for three straight quarters." if bull else
                           "The bull leans on ROE but ignores that growth has halved in a year.")
                          if "REBUTTAL round" in text else None),
                concession=("Valuation is not cheap." if bull else "The balance sheet is genuinely strong.")
                if "REBUTTAL round" in text else None,
            )
        if schema is S.ResearchPlan:
            return S.ResearchPlan(queries=["Testco sector regulation"], reason="Sector policy matters")
        if schema is S.NewsReport:
            return S.NewsReport(stance="neutral", score=5, headline="Quiet news flow", summary="Little news.",
                                key_points=["No major events"], sentiment_score=0.1, themes=["results"],
                                headlines=[S.HeadlineSentiment(index=0, sentiment="positive", impact="medium")])
        if schema is S.AnalystReport:
            return S.AnalystReport(stance="bullish", score=7, headline="Solid", summary="Good numbers.",
                                   key_points=["ROE 28%"], red_flags=[])
        if schema is S.Verdict:
            return S.Verdict(verdict="BUY", confidence=7.5, time_horizon="medium-term (3-12 months)",
                             headline="Buy on strength", bull_assessment="Strong.", bear_assessment="Weak.",
                             reasoning="Data favours bull.", decisive_factors=["ROE"], key_risks=["Valuation"],
                             catalysts=["Q3 results"], suggested_action="Accumulate.", winner="bull")
        if schema is S.RiskCommentary:
            return S.RiskCommentary(notes=["Respect the stop"], invalidation="Close below SMA200")
        if schema is S.ScreenerFilters:
            return S.ScreenerFilters(roe_min=15, sectors=["IT"], explanation="IT stocks with ROE above 15%")
        if schema is S.ScreenerRanking:
            return S.ScreenerRanking(summary="Good list", picks=[S.RankedPick(symbol="TCS.NS", rank=1, score=8,
                                                                              thesis="Quality", risk="Valuation")])
        if schema is S.CompareVerdict:
            return S.CompareVerdict(winner="TCS.NS", headline="TCS wins", reasoning="Better ROE",
                                    entries=[S.CompareEntry(symbol="TCS.NS", score=8, strengths=["ROE"],
                                                            weaknesses=["PE"], best_for="Quality")])
        if schema is S.QuickCall:
            return S.QuickCall(verdict="BUY", confidence=6, rationale="Uptrend")
        raise NotImplementedError(schema)

    # --- plain chat ---
    def invoke(self, messages):
        return AIMessage(content="Fake answer about the analysis.")

    def stream(self, messages):
        words = ["Fake ", "streamed ", "answer."]
        if self.latency:
            words = ("Demo mode answer: the call balances a strong balance sheet against slowing growth. "
                     "Watch the 200-day average as the key level; a close below it would invalidate the thesis.").split(" ")
            words = [w + " " for w in words]
        for word in words:
            if self.latency:
                time.sleep(0.04)
            yield AIMessage(content=word)
