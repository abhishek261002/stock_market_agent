# =============================================================================
# agents/schemas.py
# =============================================================================
# Pydantic models every agent returns via llm.with_structured_output(...).
# These replace the old "regex the judge's text" approach: the UI receives
# typed JSON, so changing wording in a prompt can no longer break parsing.
# .NET ANALOGY: these are your response DTOs with DataAnnotations.
# =============================================================================

from __future__ import annotations

import re
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, BeforeValidator, Field, field_validator

Stance = Literal["bullish", "neutral", "bearish"]
Action = Literal["BUY", "HOLD", "SELL"]


def _score10(v):
    """Clamp to 0-10. Models occasionally answer on a 0-1 scale — rescale those."""
    if v is None:
        return 5.0
    v = float(v)
    if 0 < v < 1:
        v *= 10
    return round(max(0.0, min(10.0, v)), 1)


Score10 = Annotated[float, BeforeValidator(_score10)]


def _clean_bullets(v):
    """Models sometimes prefix bullets with '1.' / '-' — the UI renders its own markers."""
    if not isinstance(v, list):
        return v
    # marker must be followed by whitespace, so "-22% drawdown" / "3.5% growth" survive intact
    return [re.sub(r"^\s*(?:\d+[.)]|[-•*])\s+", "", str(x)).strip() for x in v if str(x).strip()]


Bullets = Annotated[list[str], BeforeValidator(_clean_bullets)]


# --- Specialist analysts ------------------------------------------------------

class AnalystReport(BaseModel):
    stance: Stance = Field(description="Overall lean of this analysis")
    score: Score10 = Field(description="How bullish the evidence is on a 0-10 scale (0 = very bearish, 5 = neutral, 10 = very bullish)")
    headline: str = Field(description="One punchy sentence (max 15 words) summarising the finding")
    summary: str = Field(description="3-4 sentence assessment citing specific numbers")
    key_points: Bullets = Field(description="3-5 concise evidence bullets with numbers")
    red_flags: Bullets = Field(default_factory=list, description="0-3 concerns or data gaps")

class HeadlineSentiment(BaseModel):
    index: int = Field(description="Index of the headline in the provided list")
    sentiment: Literal["positive", "neutral", "negative"]
    impact: Literal["high", "medium", "low"] = Field(description="Likely price impact")


class ResearchPlan(BaseModel):
    """The news agent's tool plan: which extra searches to run."""
    queries: list[str] = Field(default_factory=list,
                               description="0-2 targeted Google News queries (3-8 words each); empty if not needed")
    reason: str = Field(default="", description="One sentence on why these searches matter")


class NewsReport(AnalystReport):
    sentiment_score: float = Field(description="Aggregate news sentiment from -1 (very negative) to 1 (very positive)")
    themes: Bullets = Field(default_factory=list, description="2-4 recurring news themes, 1-4 words each")
    headlines: list[HeadlineSentiment] = Field(default_factory=list, description="Sentiment for each headline considered")

    @field_validator("sentiment_score", mode="before")
    @classmethod
    def _clamp(cls, v):
        return max(-1.0, min(1.0, float(v or 0)))


# --- Debate ---------------------------------------------------------------------

class DebatePoint(BaseModel):
    title: str = Field(description="3-7 word label for the point")
    detail: str = Field(description="1-2 sentences of argument backed by a specific number")


class DebateArgument(BaseModel):
    thesis: str = Field(description="One-sentence core thesis")
    points: list[DebatePoint] = Field(description="3-4 strongest arguments")
    rebuttal: Optional[str] = Field(default=None, description="Direct rebuttal of the opponent's latest argument (2-3 sentences); null in the opening round")
    concession: Optional[str] = Field(default=None, description="One fair point from the opponent you concede, if any")
    confidence: Score10 = Field(description="Confidence in your side on a 0-10 scale")

# --- Judge ------------------------------------------------------------------------

class Verdict(BaseModel):
    verdict: Action
    confidence: Score10 = Field(description="Confidence in the verdict on a 0-10 scale")
    time_horizon: Literal["short-term (weeks)", "medium-term (3-12 months)", "long-term (1y+)"]
    headline: str = Field(description="One-sentence verdict summary (max 20 words)")
    bull_assessment: str = Field(description="2-3 sentences: what the bull got right and what was weak")
    bear_assessment: str = Field(description="2-3 sentences: what the bear got right and what was weak")
    reasoning: str = Field(description="3-5 sentences: why this verdict, which data points swung it")
    decisive_factors: Bullets = Field(description="2-4 data points that decided the call")
    key_risks: Bullets = Field(description="2-4 risks to watch")
    catalysts: Bullets = Field(default_factory=list, description="1-3 upcoming catalysts that could move the stock")
    suggested_action: str = Field(description="1-2 sentences of specific, actionable guidance")
    winner: Literal["bull", "bear", "draw"] = Field(description="Which debater argued better")

class RiskCommentary(BaseModel):
    notes: Bullets = Field(description="2-4 concise risk-management notes for this trade")
    invalidation: str = Field(description="One sentence: what price action or event would invalidate the thesis")


# --- Screener / compare / backtest -----------------------------------------------

class ScreenerFilters(BaseModel):
    sectors: list[str] = Field(default_factory=list, description="Sectors to include; empty = all")
    pe_max: Optional[float] = None
    pe_min: Optional[float] = None
    pb_max: Optional[float] = None
    roe_min: Optional[float] = Field(default=None, description="Minimum ROE in percent")
    de_max: Optional[float] = Field(default=None, description="Maximum debt-to-equity ratio (e.g. 0.5)")
    revenue_growth_min: Optional[float] = Field(default=None, description="Minimum YoY revenue growth in percent")
    profit_margin_min: Optional[float] = Field(default=None, description="Minimum net margin in percent")
    dividend_yield_min: Optional[float] = Field(default=None, description="Minimum dividend yield in percent")
    market_cap_min_cr: Optional[float] = Field(default=None, description="Minimum market cap in INR crore")
    rsi_min: Optional[float] = None
    rsi_max: Optional[float] = None
    change_1m_min: Optional[float] = Field(default=None, description="Minimum 1-month return in percent")
    change_1m_max: Optional[float] = None
    change_1y_min: Optional[float] = None
    above_sma200: Optional[bool] = Field(default=None, description="True = price above 200-day average")
    near_52w_high_pct: Optional[float] = Field(default=None, description="Within this many % of the 52-week high")
    sort_by: Literal["market_cap", "pe_ratio", "return_on_equity", "change_1m_pct", "change_1y_pct",
                     "revenue_growth", "dividend_yield", "rsi_14", "quality_score", "value_score",
                     "momentum_score"] = "market_cap"
    sort_desc: bool = True
    explanation: str = Field(default="", description="One sentence describing how the query was interpreted")


class RankedPick(BaseModel):
    symbol: str
    rank: int
    score: Score10 = Field(description="Attractiveness on a 0-10 scale")
    thesis: str = Field(description="One-sentence investment thesis")
    risk: str = Field(description="One-sentence key risk")

class ScreenerRanking(BaseModel):
    summary: str = Field(description="2-3 sentence overview of the shortlist")
    picks: list[RankedPick]


class CompareEntry(BaseModel):
    symbol: str
    score: Score10 = Field(description="Overall attractiveness on a 0-10 scale")
    strengths: Bullets = Field(description="2-3 strengths")
    weaknesses: Bullets = Field(description="2-3 weaknesses")
    best_for: str = Field(description="Which kind of investor this suits, one short phrase")

class CompareVerdict(BaseModel):
    winner: str = Field(description="Symbol of the most attractive stock")
    headline: str = Field(description="One-sentence conclusion")
    reasoning: str = Field(description="3-4 sentences comparing them head to head with numbers")
    entries: list[CompareEntry]


class QuickCall(BaseModel):
    """Single-shot call used by the backtester on point-in-time price data."""
    verdict: Action
    confidence: Score10 = Field(description="0-10 scale")
    rationale: str = Field(description="One sentence")
