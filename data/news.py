# =============================================================================
# data/news.py
# =============================================================================
# Recent news headlines from Google News RSS (India edition). yfinance's own
# .news feed is frequently empty for NSE tickers, so we use RSS instead.
# No API key needed. Results are cached for 15 minutes.
# =============================================================================

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests

from data.cache import ttl_cache

_RSS = "https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36"}


def _clean_title(title: str, source: str | None) -> str:
    # Google appends " - Source Name" to every title
    if source and title.endswith(f" - {source}"):
        return title[: -len(source) - 3].strip()
    return re.sub(r"\s+-\s+[^-]+$", "", title).strip()


def parse_rss(xml_bytes: bytes, limit: int = 15) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    items, seen = [], set()
    for it in root.findall(".//item"):
        source = it.findtext("source")
        title = _clean_title(it.findtext("title") or "", source)
        key = title.lower()[:80]
        if not title or key in seen:
            continue
        seen.add(key)
        published = None
        raw_date = it.findtext("pubDate")
        if raw_date:
            try:
                published = parsedate_to_datetime(raw_date).isoformat()
            except (TypeError, ValueError):
                published = None
        items.append({
            "title":     title,
            "source":    source or "Google News",
            "published": published,
            "link":      it.findtext("link"),
        })
    items.sort(key=lambda x: x["published"] or "", reverse=True)
    return items[:limit]


@ttl_cache(900)
def search_news(query: str, limit: int = 15) -> list[dict]:
    """Searches Google News for `query`. Returns [] on any network failure."""
    try:
        r = requests.get(_RSS.format(q=quote_plus(query)), headers=_HEADERS, timeout=12)
        r.raise_for_status()
        return parse_rss(r.content, limit)
    except Exception as e:  # network / parse errors must never break analysis
        print(f"[News] search failed for '{query}': {e}")
        return []


def company_query(name: str, symbol: str) -> str:
    base = symbol.split(".")[0]
    clean = re.sub(r"\b(Limited|Ltd\.?|Corporation|Corp\.?|Company)\b", "", name or base, flags=re.I).strip()
    return f"{clean or base} share price"
