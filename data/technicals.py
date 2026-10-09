# =============================================================================
# data/technicals.py
# =============================================================================
# Pure-pandas technical indicators. No network, no LLM — just maths on an
# OHLCV DataFrame, so everything here is deterministic and unit-tested.
#
# Implemented with standard textbook definitions (Wilder smoothing for RSI/ATR)
# rather than a third-party TA lib, to avoid numpy/pandas version breakage.
# =============================================================================

from __future__ import annotations

import math
from typing import Optional

import numpy as np
import pandas as pd


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=window).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def wilder(values: pd.Series, period: int) -> pd.Series:
    """Wilder smoothing: seed = simple mean of the first `period` values, then
    avg_t = (avg_{t-1} * (period - 1) + x_t) / period. Matches TradingView/StockCharts."""
    arr = values.to_numpy(dtype=float)
    out = np.full(len(arr), np.nan)
    valid = np.where(~np.isnan(arr))[0]
    if len(valid) < period:
        return pd.Series(out, index=values.index)
    start = valid[0]
    seed_end = start + period
    if seed_end > len(arr) or np.isnan(arr[start:seed_end]).any():
        return pd.Series(out, index=values.index)
    out[seed_end - 1] = arr[start:seed_end].mean()
    for i in range(seed_end, len(arr)):
        x = arr[i] if not np.isnan(arr[i]) else 0.0
        out[i] = (out[i - 1] * (period - 1) + x) / period
    return pd.Series(out, index=values.index)


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder). 0-100; >70 overbought, <30 oversold."""
    delta = close.diff()
    avg_gain = wilder(delta.clip(lower=0), period)
    avg_loss = wilder(-delta.clip(upper=0), period)
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    # No losses at all in the window → RSI is 100 by definition
    out = out.where(~((avg_loss == 0) & avg_gain.notna()), 100.0)
    return out


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})


def bollinger(close: pd.Series, window: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(close, window)
    std = close.rolling(window=window, min_periods=window).std(ddof=0)
    return pd.DataFrame({"mid": mid, "upper": mid + k * std, "lower": mid - k * std})


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range (Wilder) — the typical daily price swing in rupees."""
    prev_close = df["Close"].shift(1)
    tr = pd.concat([
        df["High"] - df["Low"],
        (df["High"] - prev_close).abs(),
        (df["Low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    tr.iloc[0] = np.nan            # first bar has no previous close
    return wilder(tr, period)


def pct_change_over(close: pd.Series, days: int) -> Optional[float]:
    """% change over the last `days` trading sessions (None if not enough data)."""
    if len(close) <= days:
        return None
    past = close.iloc[-days - 1]
    if not past:
        return None
    return round(float((close.iloc[-1] - past) / past * 100), 2)


def annualised_volatility(close: pd.Series, window: int = 60) -> Optional[float]:
    rets = close.pct_change().dropna().tail(window)
    if len(rets) < 10:
        return None
    return round(float(rets.std() * math.sqrt(252) * 100), 2)


def max_drawdown(close: pd.Series) -> Optional[float]:
    if close.empty:
        return None
    peak = close.cummax()
    dd = (close - peak) / peak
    return round(float(dd.min() * 100), 2)


def _last(series: pd.Series) -> Optional[float]:
    if series is None or series.empty:
        return None
    v = series.iloc[-1]
    return None if pd.isna(v) else round(float(v), 2)


def classify_trend(price: float, s50: Optional[float], s200: Optional[float]) -> str:
    if s50 is None or s200 is None:
        return "insufficient data"
    if price > s50 > s200:
        return "strong uptrend"
    if price > s200 and s50 > s200:
        return "uptrend"
    if price < s50 < s200:
        return "strong downtrend"
    if price < s200 and s50 < s200:
        return "downtrend"
    return "sideways / transitioning"


def compute_snapshot(df: pd.DataFrame, benchmark_close: Optional[pd.Series] = None) -> dict:
    """Summarises the latest technical state of an OHLCV DataFrame as plain floats."""
    close = df["Close"].dropna()
    price = float(close.iloc[-1])
    s20, s50, s200 = _last(sma(close, 20)), _last(sma(close, 50)), _last(sma(close, 200))
    m = macd(close)
    bb = bollinger(close)
    a = _last(atr(df))
    r = _last(rsi(close))

    bb_pos = None
    bu, bl = _last(bb["upper"]), _last(bb["lower"])
    if bu is not None and bl is not None and bu != bl:
        bb_pos = round((price - bl) / (bu - bl) * 100, 1)   # 0 = lower band, 100 = upper

    rel_strength_3m = None
    if benchmark_close is not None and len(benchmark_close) > 63:
        stock_3m = pct_change_over(close, 63)
        bench_3m = pct_change_over(benchmark_close.dropna(), 63)
        if stock_3m is not None and bench_3m is not None:
            rel_strength_3m = round(stock_3m - bench_3m, 2)

    macd_line, macd_sig = _last(m["macd"]), _last(m["signal"])
    macd_state = None
    if macd_line is not None and macd_sig is not None:
        macd_state = "bullish" if macd_line > macd_sig else "bearish"

    return {
        "rsi_14":            r,
        "sma_20":            s20,
        "sma_50":            s50,
        "sma_200":           s200,
        "macd":              macd_line,
        "macd_signal":       macd_sig,
        "macd_hist":         _last(m["hist"]),
        "macd_state":        macd_state,
        "bb_upper":          bu,
        "bb_lower":          bl,
        "bb_position_pct":   bb_pos,
        "atr_14":            a,
        "atr_pct":           round(a / price * 100, 2) if a else None,
        "volatility_ann":    annualised_volatility(close),
        "max_drawdown_1y":   max_drawdown(close.tail(252)),
        "change_1w_pct":     pct_change_over(close, 5),
        "change_1m_pct":     pct_change_over(close, 21),
        "change_3m_pct":     pct_change_over(close, 63),
        "change_6m_pct":     pct_change_over(close, 126),
        # a "1y" Yahoo window holds ~245-250 sessions, so use the full window when shorter
        "change_1y_pct":     pct_change_over(close, min(250, len(close) - 1)),
        "rel_strength_3m":   rel_strength_3m,   # stock 3m return minus Nifty 3m return
        "trend":             classify_trend(price, s50, s200),
    }


def rule_signal(snapshot: dict, price: float) -> str:
    """Simple non-AI baseline signal used to benchmark the agents in backtests."""
    s50, s200, r = snapshot.get("sma_50"), snapshot.get("sma_200"), snapshot.get("rsi_14")
    if s50 is None or s200 is None or r is None:
        return "HOLD"
    if price > s50 > s200 and r < 70:
        return "BUY"
    if price < s50 < s200 and r > 30:
        return "SELL"
    return "HOLD"


def chart_series(df: pd.DataFrame) -> dict:
    """OHLCV + overlay series in the shape the frontend chart expects."""
    close = df["Close"]
    ind = pd.DataFrame({
        "sma20": sma(close, 20), "sma50": sma(close, 50), "sma200": sma(close, 200),
        "rsi": rsi(close),
    })
    m = macd(close)
    out = []
    for ts, row in df.iterrows():
        t = ts.strftime("%Y-%m-%d")
        i = ind.loc[ts]
        out.append({
            "time":   t,
            "open":   round(float(row["Open"]), 2),
            "high":   round(float(row["High"]), 2),
            "low":    round(float(row["Low"]), 2),
            "close":  round(float(row["Close"]), 2),
            "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
            "sma20":  None if pd.isna(i["sma20"]) else round(float(i["sma20"]), 2),
            "sma50":  None if pd.isna(i["sma50"]) else round(float(i["sma50"]), 2),
            "sma200": None if pd.isna(i["sma200"]) else round(float(i["sma200"]), 2),
            "rsi":    None if pd.isna(i["rsi"]) else round(float(i["rsi"]), 2),
            "macd_hist": None if pd.isna(m.loc[ts, "hist"]) else round(float(m.loc[ts, "hist"]), 3),
        })
    return {"candles": out}
