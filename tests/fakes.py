# =============================================================================
# tests/fakes.py — offline stand-ins for Gemini and Yahoo Finance
# =============================================================================

from __future__ import annotations

import numpy as np
import pandas as pd
from agents.mock_llm import FakeLLM  # noqa: F401  (re-exported for tests)


def make_history(n: int = 300, start: float = 100.0, drift: float = 0.001, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, 0.015, n)
    close = start * np.cumprod(1 + rets)
    idx = pd.bdate_range(end="2026-10-08", periods=n)
    high = close * (1 + rng.uniform(0, 0.01, n))
    low = close * (1 - rng.uniform(0, 0.01, n))
    open_ = (high + low) / 2
    vol = rng.integers(1_000_000, 3_000_000, n)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx)


FAKE_INFO = {
    "longName": "Testco Limited", "sector": "Technology", "industry": "IT Services", "exchange": "NSI",
    "trailingPE": 22.5, "forwardPE": 20.1, "priceToBook": 5.2, "trailingEps": 50.0,
    "revenueGrowth": 0.12, "earningsGrowth": 0.15, "profitMargins": 0.18, "operatingMargins": 0.22,
    "marketCap": 5_000_000_000_000, "debtToEquity": 12.0, "returnOnEquity": 0.28,
    "dividendYield": 1.8, "recommendationKey": "buy", "targetMeanPrice": 150.0,
    "fiftyTwoWeekHigh": 160.0, "fiftyTwoWeekLow": 90.0, "numberOfAnalystOpinions": 30,
}


