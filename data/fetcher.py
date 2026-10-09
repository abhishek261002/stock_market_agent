# =============================================================================
# data/fetcher.py
# =============================================================================
# THE DATA FETCHER — pulls fundamentals, 1y price history, technicals,
# quarterly financials and peer data from Yahoo Finance, and turns them into:
#   1. fetch_stock_data()  → a flat dict (the "DTO") the agents and UI consume
#   2. format_for_agent()  → the fixed-format text block injected into prompts
#   3. get_stock_detail()  → the richer payload the UI's stock page renders
#
# UNITS (normalised here so nothing downstream has to guess):
#   *_pct / growth / margin / roe / dividend_yield → percent (12.5 = 12.5%)
#   debt_to_equity                                 → ratio   (0.35 = 0.35x)
#   market_cap / price                             → INR
#
# NOTE: yfinance ≥0.2.5x manages its own curl_cffi browser session internally,
# which is what gets past Yahoo's bot checks — passing a plain requests.Session
# actually breaks it, so we no longer build one here.
# =============================================================================

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

from data.cache import ttl_cache
from data.technicals import chart_series, compute_snapshot
from data.universe import BENCHMARK, lookup, peers_of

load_dotenv()


# =============================================================================
# RAW FETCHERS (cached)
# =============================================================================

@ttl_cache(3600)
def get_info(symbol: str) -> dict:
    try:
        return yf.Ticker(symbol).info or {}
    except Exception as e:
        print(f"[DataFetcher] info failed for {symbol}: {e}")
        return {}


@ttl_cache(300)
def get_history(symbol: str, period: str = "1y") -> pd.DataFrame:
    df = yf.Ticker(symbol).history(period=period, auto_adjust=True)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df


@ttl_cache(300)
def get_benchmark_close(period: str = "1y") -> pd.Series:
    df = get_history(BENCHMARK, period)
    return df["Close"] if not df.empty else pd.Series(dtype=float)


@ttl_cache(6 * 3600)
def get_quarterly_financials(symbol: str) -> list[dict]:
    """Last ~8 quarters of revenue / profit, oldest first."""
    try:
        q = yf.Ticker(symbol).quarterly_income_stmt
    except Exception as e:
        print(f"[DataFetcher] financials failed for {symbol}: {e}")
        return []
    if q is None or q.empty:
        return []

    def row(name: str) -> pd.Series | None:
        return q.loc[name] if name in q.index else None

    revenue = row("Total Revenue")
    net     = row("Net Income")
    op      = row("Operating Income")
    eps     = row("Diluted EPS")
    out = []
    for col in sorted(q.columns)[-8:]:
        def val(s):
            if s is None:
                return None
            v = s.get(col)
            return None if v is None or pd.isna(v) else float(v)
        rev, ni, oi = val(revenue), val(net), val(op)
        out.append({
            "period":            pd.Timestamp(col).strftime("%b %Y"),
            "revenue":           rev,
            "net_income":        ni,
            "operating_income":  oi,
            "eps":               val(eps),
            "net_margin_pct":    round(ni / rev * 100, 2) if rev and ni is not None else None,
            "op_margin_pct":     round(oi / rev * 100, 2) if rev and oi is not None else None,
        })
    return [r for r in out if r["revenue"] is not None or r["net_income"] is not None]


# =============================================================================
# HELPERS
# =============================================================================

def _pct(v) -> Optional[float]:
    """Fraction → percent (0.125 → 12.5)."""
    return None if v is None else round(float(v) * 100, 2)


def _num(v, nd: int = 2) -> Optional[float]:
    try:
        if v is None or pd.isna(v):
            return None
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


# =============================================================================
# MAIN DTO
# =============================================================================

def fetch_stock_data(symbol: str) -> dict:
    """
    Fetches fundamentals + price/technical signals for an NSE/BSE symbol.

    Args:
        symbol: Yahoo ticker, e.g. "RELIANCE.NS" (NSE) or "RELIANCE.BO" (BSE)

    Returns:
        dict: flat DTO. Raises ValueError if the symbol has no price data.
    """
    print(f"\n[DataFetcher] Fetching data for: {symbol}")

    history = get_history(symbol, "1y")
    if history.empty or len(history) < 22:
        raise ValueError(
            f"No data found for symbol '{symbol}'. "
            f"Use NSE format e.g. 'RELIANCE.NS' (BSE: 'RELIANCE.BO')"
        )
    info = get_info(symbol)
    tech = compute_snapshot(history, get_benchmark_close("1y"))

    close = history["Close"]
    current_price = round(float(close.iloc[-1]), 2)
    prev_close    = float(close.iloc[-2]) if len(close) > 1 else current_price
    change_1d     = round((current_price - prev_close) / prev_close * 100, 2) if prev_close else None

    avg_volume_20d = int(round(history["Volume"].tail(20).mean()))
    latest_volume  = int(history["Volume"].iloc[-1])
    volume_ratio   = round(latest_volume / avg_volume_20d, 2) if avg_volume_20d else None

    # 52-week range from actual history (more reliable than info for fresh listings)
    week52_high = _num(info.get("fiftyTwoWeekHigh")) or round(float(history["High"].max()), 2)
    week52_low  = _num(info.get("fiftyTwoWeekLow"))  or round(float(history["Low"].min()), 2)
    pct_from_52w_high = round((current_price - week52_high) / week52_high * 100, 2) if week52_high else None
    pct_from_52w_low  = round((current_price - week52_low) / week52_low * 100, 2) if week52_low else None

    d2e = info.get("debtToEquity")
    target = _num(info.get("targetMeanPrice"))
    meta = lookup(symbol) or {}

    stock_data = {
        # --- Identity ---
        "symbol":   symbol,
        "name":     info.get("longName") or info.get("shortName") or meta.get("name") or symbol,
        "sector":   info.get("sector") or meta.get("sector") or "N/A",
        "industry": info.get("industry", "N/A"),
        "exchange": {"NSI": "NSE", "BSE": "BSE"}.get(info.get("exchange"), info.get("exchange", "N/A")),
        "universe_sector": meta.get("sector"),
        "summary":  (info.get("longBusinessSummary") or "")[:600],
        "website":  info.get("website"),
        "financial_currency": info.get("financialCurrency") or "INR",

        # --- Price signals ---
        "current_price":       current_price,
        "previous_close":      round(prev_close, 2),
        "change_1d_pct":       change_1d,
        "price_change_1m_pct": tech["change_1m_pct"],
        "week_52_high":        week52_high,
        "week_52_low":         week52_low,
        "pct_from_52w_high":   pct_from_52w_high,
        "pct_from_52w_low":    pct_from_52w_low,

        # --- Valuation ---
        "pe_ratio":        _num(info.get("trailingPE")),
        "forward_pe":      _num(info.get("forwardPE")),
        "peg_ratio":       _num(info.get("pegRatio") or info.get("trailingPegRatio")),
        "price_to_book":   _num(info.get("priceToBook")),
        "ev_to_ebitda":    _num(info.get("enterpriseToEbitda")),
        "eps_ttm":         _num(info.get("trailingEps")),
        "revenue_growth":  _pct(info.get("revenueGrowth")),
        "earnings_growth": _pct(info.get("earningsGrowth")),
        "profit_margin":   _pct(info.get("profitMargins")),
        "operating_margin": _pct(info.get("operatingMargins")),

        # --- Size & health ---
        "market_cap":       info.get("marketCap"),
        "debt_to_equity":   round(float(d2e) / 100, 2) if d2e is not None else None,
        "return_on_equity": _pct(info.get("returnOnEquity")),
        "return_on_assets": _pct(info.get("returnOnAssets")),
        "current_ratio":    _num(info.get("currentRatio")),
        "dividend_yield":   _num(info.get("dividendYield")),   # yfinance already returns percent
        "payout_ratio":     _pct(info.get("payoutRatio")),
        "beta":             _num(info.get("beta")),
        "insider_holding_pct":     _pct(info.get("heldPercentInsiders")),
        "institution_holding_pct": _pct(info.get("heldPercentInstitutions")),

        # --- Volume ---
        "latest_volume":  latest_volume,
        "avg_volume_20d": avg_volume_20d,
        "volume_ratio":   volume_ratio,

        # --- Analyst consensus ---
        "analyst_recommendation": info.get("recommendationKey") or "N/A",
        "analyst_count":          info.get("numberOfAnalystOpinions"),
        "target_price":           target,
        "target_high":            _num(info.get("targetHighPrice")),
        "target_low":             _num(info.get("targetLowPrice")),
        "target_upside_pct":      round((target - current_price) / current_price * 100, 2) if target else None,

        # --- Technicals (see data/technicals.py) ---
        **{f"tech_{k}": v for k, v in tech.items()},

        # --- Metadata ---
        "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    print(f"[DataFetcher] Done. Fetched {len(stock_data)} data points for {symbol}.")
    return stock_data


def format_for_agent(stock_data: dict) -> str:
    """
    Serialises the stock_data dict into the fixed text block every agent reads.
    LLMs only ever see this text — never the dict or a DataFrame.
    """

    def fmt(value, suffix="", prefix="", decimals=2):
        if value is None:
            return "N/A"
        if isinstance(value, float):
            return f"{prefix}{value:,.{decimals}f}{suffix}"
        if isinstance(value, int):
            return f"{prefix}{value:,}{suffix}"
        return f"{prefix}{value}{suffix}"

    def crore(v):
        return "N/A" if v is None else f"₹{v / 1e7:,.0f} Cr"

    d = stock_data
    vr = d.get("volume_ratio")
    formatted = f"""
STOCK ANALYSIS DATA
===================
Company  : {d['name']} ({d['symbol']})
Sector   : {d['sector']} — {d['industry']}
Exchange : {d['exchange']}
As of    : {d['fetched_at']}

PRICE INFORMATION
-----------------
Current Price        : {fmt(d['current_price'], prefix='₹')}
1-Day Change         : {fmt(d.get('change_1d_pct'), suffix='%')}
1-Week / 1-Month     : {fmt(d.get('tech_change_1w_pct'), suffix='%')} / {fmt(d['price_change_1m_pct'], suffix='%')}
3-Month / 6-Month    : {fmt(d.get('tech_change_3m_pct'), suffix='%')} / {fmt(d.get('tech_change_6m_pct'), suffix='%')}
1-Year Change        : {fmt(d.get('tech_change_1y_pct'), suffix='%')}
52-Week High / Low   : {fmt(d['week_52_high'], prefix='₹')} / {fmt(d['week_52_low'], prefix='₹')}
% From 52W High      : {fmt(d['pct_from_52w_high'], suffix='%')}
% From 52W Low       : {fmt(d['pct_from_52w_low'], suffix='%')}

TECHNICALS
----------
Trend (50/200 SMA)   : {d.get('tech_trend', 'N/A')}
SMA 20 / 50 / 200    : {fmt(d.get('tech_sma_20'), prefix='₹')} / {fmt(d.get('tech_sma_50'), prefix='₹')} / {fmt(d.get('tech_sma_200'), prefix='₹')}
RSI (14)             : {fmt(d.get('tech_rsi_14'))}
MACD                 : {fmt(d.get('tech_macd'))} vs signal {fmt(d.get('tech_macd_signal'))} ({d.get('tech_macd_state') or 'N/A'})
Bollinger position   : {fmt(d.get('tech_bb_position_pct'), suffix='%')} (0% = lower band, 100% = upper)
ATR (14)             : {fmt(d.get('tech_atr_14'), prefix='₹')} ({fmt(d.get('tech_atr_pct'), suffix='% of price')})
Volatility (ann.)    : {fmt(d.get('tech_volatility_ann'), suffix='%')}
Max drawdown (1Y)    : {fmt(d.get('tech_max_drawdown_1y'), suffix='%')}
Rel. strength vs NIFTY (3M): {fmt(d.get('tech_rel_strength_3m'), suffix=' pp')}

VALUATION METRICS
-----------------
P/E Ratio (TTM)      : {fmt(d['pe_ratio'])}
Forward P/E          : {fmt(d['forward_pe'])}
PEG Ratio            : {fmt(d.get('peg_ratio'))}
Price-to-Book        : {fmt(d['price_to_book'])}
EPS (TTM)            : {fmt(d['eps_ttm'], prefix='₹')}
Revenue Growth (YoY) : {fmt(d['revenue_growth'], suffix='%')}
Earnings Growth(YoY) : {fmt(d['earnings_growth'], suffix='%')}
Profit Margin        : {fmt(d['profit_margin'], suffix='%')}
Operating Margin     : {fmt(d.get('operating_margin'), suffix='%')}

COMPANY HEALTH
--------------
Market Cap           : {crore(d['market_cap'])}
Debt-to-Equity       : {fmt(d['debt_to_equity'], suffix='x')}
Return on Equity     : {fmt(d['return_on_equity'], suffix='%')}
Return on Assets     : {fmt(d.get('return_on_assets'), suffix='%')}
Current Ratio        : {fmt(d.get('current_ratio'))}
Dividend Yield       : {fmt(d['dividend_yield'], suffix='%')}
Beta                 : {fmt(d.get('beta'))}
Insider / Institution holding: {fmt(d.get('insider_holding_pct'), suffix='%')} / {fmt(d.get('institution_holding_pct'), suffix='%')}

VOLUME ACTIVITY
---------------
Today's Volume       : {fmt(d['latest_volume'])}
20-Day Avg Volume    : {fmt(d['avg_volume_20d'])}
Volume Ratio         : {fmt(vr)}x  {'(HIGH ACTIVITY)' if vr and vr > 1.5 else ''}

ANALYST VIEW
------------
Consensus            : {str(d['analyst_recommendation']).upper()} ({fmt(d.get('analyst_count'))} analysts)
Mean Target Price    : {fmt(d['target_price'], prefix='₹')} ({fmt(d.get('target_upside_pct'), suffix='% upside')})
"""
    return formatted.strip()


# =============================================================================
# LIGHTWEIGHT SNAPSHOTS (peers, compare, screener)
# =============================================================================

def light_snapshot(symbol: str) -> dict | None:
    """A compact row of key metrics; None if the symbol has no data."""
    try:
        hist = get_history(symbol, "1y")
        if hist.empty:
            return None
        info = get_info(symbol)
        close = hist["Close"]
        price = float(close.iloc[-1])
        prev = float(close.iloc[-2]) if len(close) > 1 else price
        start = float(close.iloc[0])
        d2e = info.get("debtToEquity")
        meta = lookup(symbol) or {}
        return {
            "symbol":          symbol,
            "name":            info.get("longName") or info.get("shortName") or meta.get("name") or symbol,
            "sector":          meta.get("sector") or info.get("sector"),
            "price":           round(price, 2),
            "change_1d_pct":   round((price - prev) / prev * 100, 2) if prev else None,
            "change_1y_pct":   round((price - start) / start * 100, 2) if start else None,
            "market_cap":      info.get("marketCap"),
            "pe_ratio":        _num(info.get("trailingPE")),
            "price_to_book":   _num(info.get("priceToBook")),
            "return_on_equity": _pct(info.get("returnOnEquity")),
            "revenue_growth":  _pct(info.get("revenueGrowth")),
            "profit_margin":   _pct(info.get("profitMargins")),
            "debt_to_equity":  round(float(d2e) / 100, 2) if d2e is not None else None,
            "dividend_yield":  _num(info.get("dividendYield")),
            "sparkline":       [round(float(x), 2) for x in close.tail(60).tolist()],
        }
    except Exception as e:
        print(f"[DataFetcher] snapshot failed for {symbol}: {e}")
        return None


def get_peer_snapshots(symbol: str, limit: int = 5) -> list[dict]:
    peers = peers_of(symbol, limit)
    if not peers:
        return []
    with ThreadPoolExecutor(max_workers=5) as pool:
        rows = list(pool.map(light_snapshot, peers))
    return [r for r in rows if r]


def format_peers_for_agent(peers: list[dict]) -> str:
    if not peers:
        return "No peer data available."
    lines = ["Symbol | P/E | P/B | ROE% | RevGrowth% | Margin% | D/E | 1Y%"]
    for p in peers:
        def f(v):
            return "N/A" if v is None else f"{v:.1f}"
        lines.append(
            f"{p['symbol']} | {f(p['pe_ratio'])} | {f(p['price_to_book'])} | {f(p['return_on_equity'])} | "
            f"{f(p['revenue_growth'])} | {f(p['profit_margin'])} | {f(p['debt_to_equity'])} | {f(p['change_1y_pct'])}"
        )
    return "\n".join(lines)


def format_financials_for_agent(rows: list[dict], currency: str = "INR") -> str:
    if not rows:
        return "Quarterly financials unavailable."
    unit = "Cr" if currency == "INR" else f"M {currency}"
    div = 1e7 if currency == "INR" else 1e6
    lines = [f"Quarter | Revenue ({unit}) | Net income ({unit}) | Net margin% | Op margin%"]
    for r in rows:
        def f(v, d=div):
            return "N/A" if v is None else f"{v / d:,.0f}"
        def p(v):
            return "N/A" if v is None else f"{v:.1f}"
        lines.append(f"{r['period']} | {f(r['revenue'])} | {f(r['net_income'])} | {p(r['net_margin_pct'])} | {p(r['op_margin_pct'])}")
    return "\n".join(lines)


def get_stock_detail(symbol: str) -> dict:
    """Everything the UI's stock page needs in one payload."""
    data = fetch_stock_data(symbol)
    with ThreadPoolExecutor(max_workers=3) as pool:
        f_hist  = pool.submit(get_history, symbol, "2y")
        f_fin   = pool.submit(get_quarterly_financials, symbol)
        f_peers = pool.submit(get_peer_snapshots, symbol)
        hist2y  = f_hist.result()
        return {
            "data":       data,
            "chart":      chart_series(hist2y if not hist2y.empty else get_history(symbol, "1y")),
            "financials": f_fin.result(),
            "peers":      f_peers.result(),
        }
