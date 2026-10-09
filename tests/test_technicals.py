import math

import numpy as np
import pandas as pd
import pytest

from data import technicals as T
from tests.fakes import make_history


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.arange(1, 60, dtype=float))
    down = pd.Series(np.arange(60, 1, -1, dtype=float))
    assert T.rsi(up).iloc[-1] == pytest.approx(100.0)
    assert T.rsi(down).iloc[-1] == pytest.approx(0.0, abs=1e-9)
    r = T.rsi(make_history()["Close"]).dropna()
    assert ((r >= 0) & (r <= 100)).all()


def test_rsi_matches_wilder_reference():
    # StockCharts' published RSI(14) worked example
    closes = pd.Series([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
                        45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64])
    r = T.rsi(closes)
    assert r.iloc[:14].isna().all()
    assert r.iloc[14] == pytest.approx(70.53, abs=0.15)
    assert r.iloc[-1] == pytest.approx(57.97, abs=0.15)
    assert not math.isnan(r.iloc[-1])


def test_sma_and_macd_shapes():
    c = make_history()["Close"]
    assert T.sma(c, 20).iloc[:19].isna().all()
    assert T.sma(c, 20).iloc[19] == pytest.approx(c.iloc[:20].mean())
    m = T.macd(c)
    assert list(m.columns) == ["macd", "signal", "hist"]
    assert (m["hist"] - (m["macd"] - m["signal"])).abs().max() < 1e-9


def test_atr_positive_and_bollinger_ordering():
    df = make_history()
    assert (T.atr(df).dropna() > 0).all()
    bb = T.bollinger(df["Close"]).dropna()
    assert (bb["upper"] >= bb["mid"]).all() and (bb["mid"] >= bb["lower"]).all()


def test_pct_change_and_drawdown():
    s = pd.Series([100, 110, 99, 120.0])
    assert T.pct_change_over(s, 3) == 20.0
    assert T.pct_change_over(s, 10) is None
    assert T.max_drawdown(s) == -10.0


def test_trend_classification():
    assert T.classify_trend(120, 110, 100) == "strong uptrend"
    assert T.classify_trend(80, 90, 100) == "strong downtrend"
    assert T.classify_trend(100, None, 90) == "insufficient data"


def test_snapshot_and_rule_signal():
    df = make_history(drift=0.003)  # strong uptrend
    snap = T.compute_snapshot(df, make_history(seed=3)["Close"])
    for k in ("rsi_14", "sma_200", "atr_14", "volatility_ann", "rel_strength_3m", "trend"):
        assert snap[k] is not None
    price = float(df["Close"].iloc[-1])
    assert T.rule_signal(snap, price) in ("BUY", "HOLD", "SELL")
    assert T.rule_signal({"sma_50": None}, 1) == "HOLD"


def test_chart_series_shape():
    out = T.chart_series(make_history(n=250))
    c = out["candles"]
    assert len(c) == 250
    assert c[0]["sma200"] is None and c[-1]["sma200"] is not None
    assert set(c[-1]) >= {"time", "open", "high", "low", "close", "volume", "rsi", "macd_hist"}
