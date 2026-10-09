# =============================================================================
# services/market.py
# =============================================================================
# The dashboard's market overview: index cards, ticker tape, top movers,
# sector performance heatmap and market breadth. One batched Yahoo download
# for the whole universe, cached for 2 minutes.
# =============================================================================

from __future__ import annotations

from datetime import datetime, time as dtime, timedelta, timezone

import pandas as pd
import yfinance as yf

from data.cache import ttl_cache
from data.universe import INDICES, UNIVERSE

IST = timezone(timedelta(hours=5, minutes=30))


def market_status(now: datetime | None = None) -> dict:
    now = (now or datetime.now(IST)).astimezone(IST)
    open_t, close_t = dtime(9, 15), dtime(15, 30)
    is_weekday = now.weekday() < 5
    is_open = is_weekday and open_t <= now.time() <= close_t
    if is_open:
        label = "Market open"
    elif is_weekday and now.time() < open_t:
        label = "Pre-open"
    else:
        label = "Market closed"
    return {"open": is_open, "label": label, "time_ist": now.strftime("%d %b %Y, %H:%M IST")}


def _series_stats(close: pd.Series) -> dict | None:
    close = close.dropna()
    if len(close) < 2:
        return None
    last, prev = float(close.iloc[-1]), float(close.iloc[-2])
    first = float(close.iloc[0])
    return {
        "price":         round(last, 2),
        "change":        round(last - prev, 2),
        "change_pct":    round((last - prev) / prev * 100, 2),
        "change_1m_pct": round((last - first) / first * 100, 2),
        "sparkline":     [round(float(x), 2) for x in close.tail(30).tolist()],
    }


@ttl_cache(120)
def market_overview() -> dict:
    symbols = [i["symbol"] for i in INDICES] + [u["symbol"] for u in UNIVERSE]
    raw = yf.download(symbols, period="1mo", group_by="ticker", progress=False, threads=True, auto_adjust=True)
    level0 = set(raw.columns.get_level_values(0)) if not raw.empty else set()

    def stats(sym):
        if sym not in level0:
            return None
        return _series_stats(raw[sym]["Close"])

    indices = []
    for i in INDICES:
        s = stats(i["symbol"])
        if s:
            indices.append({**i, **s})

    stocks = []
    for u in UNIVERSE:
        s = stats(u["symbol"])
        if s:
            stocks.append({**u, **s})

    by_change = sorted(stocks, key=lambda r: r["change_pct"], reverse=True)
    sectors: dict[str, list[dict]] = {}
    for r in stocks:
        sectors.setdefault(r["sector"], []).append(r)
    sector_perf = sorted([
        {
            "sector":        sec,
            "change_pct":    round(sum(r["change_pct"] for r in rs) / len(rs), 2),
            "change_1m_pct": round(sum(r["change_1m_pct"] for r in rs) / len(rs), 2),
            "count":         len(rs),
            "stocks":        sorted(({"symbol": r["symbol"], "name": r["name"], "change_pct": r["change_pct"],
                                      "price": r["price"]} for r in rs),
                                    key=lambda x: x["change_pct"], reverse=True),
        }
        for sec, rs in sectors.items()
    ], key=lambda s: s["change_pct"], reverse=True)

    advancers = sum(1 for r in stocks if r["change_pct"] > 0)
    decliners = sum(1 for r in stocks if r["change_pct"] < 0)

    return {
        "status":    market_status(),
        "indices":   indices,
        "gainers":   by_change[:6],
        "losers":    list(reversed(by_change[-6:])),
        "sectors":   sector_perf,
        "breadth":   {"advancers": advancers, "decliners": decliners,
                      "unchanged": len(stocks) - advancers - decliners, "total": len(stocks)},
        "tape":      [{"symbol": r["symbol"], "price": r["price"], "change_pct": r["change_pct"]}
                      for r in stocks[:40]],
        "updated_at": datetime.now(IST).isoformat(timespec="seconds"),
    }


@ttl_cache(60)
def latest_prices(symbols: tuple[str, ...]) -> dict[str, float]:
    """Last traded price per symbol (used by price alerts & watchlist)."""
    if not symbols:
        return {}
    raw = yf.download(list(symbols), period="5d", group_by="ticker", progress=False, threads=True, auto_adjust=True)
    out = {}
    level0 = set(raw.columns.get_level_values(0)) if not raw.empty else set()
    for s in symbols:
        if s in level0:
            c = raw[s]["Close"].dropna()
            if not c.empty:
                out[s] = round(float(c.iloc[-1]), 2)
    return out
