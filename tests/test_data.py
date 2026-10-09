import pytest

from data import fetcher
from data.news import _clean_title, company_query, parse_rss
from data.universe import normalise_symbol, peers_of, search_universe, universe_symbols

RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>Infosys wins $1bn deal - Mint</title><source>Mint</source>
<pubDate>Fri, 09 Oct 2026 04:29:12 GMT</pubDate><link>https://a</link></item>
<item><title>Infosys wins $1bn deal - Mint</title><source>Mint</source>
<pubDate>Fri, 09 Oct 2026 04:29:12 GMT</pubDate><link>https://dup</link></item>
<item><title>IT stocks rally - ET</title><source>ET</source>
<pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate><link>https://b</link></item>
</channel></rss>"""


def test_parse_rss_dedupes_sorts_and_strips_source():
    items = parse_rss(RSS)
    assert [i["title"] for i in items] == ["Infosys wins $1bn deal", "IT stocks rally"]
    assert items[0]["published"].startswith("2026-10-09")
    assert _clean_title("A - B - Reuters", "Reuters") == "A - B"


def test_company_query():
    assert company_query("Infosys Limited", "INFY.NS") == "Infosys share price"
    assert company_query("", "TCS.NS") == "TCS share price"


def test_universe_helpers():
    assert normalise_symbol(" infy ") == "INFY.NS"
    assert normalise_symbol("RELIANCE.BO") == "RELIANCE.BO"
    assert normalise_symbol("^NSEI") == "^NSEI"
    assert search_universe("infy")[0]["symbol"] == "INFY.NS"
    assert search_universe("hdfc")  # prefix match on symbol / name
    assert "TCS.NS" in peers_of("INFY.NS") and "INFY.NS" not in peers_of("INFY.NS")
    assert len(universe_symbols()) == len(set(universe_symbols()))


def test_fetch_stock_data_units(fake_market):
    d = fetcher.fetch_stock_data("TCS.NS")
    assert d["revenue_growth"] == 12.0          # fraction → percent
    assert d["return_on_equity"] == 28.0
    assert d["debt_to_equity"] == 0.12          # percent-style → ratio
    assert d["dividend_yield"] == 1.8           # already percent
    assert d["tech_rsi_14"] is not None
    assert d["target_upside_pct"] is not None


def test_format_for_agent_has_all_sections(fake_market):
    text = fetcher.format_for_agent(fetcher.fetch_stock_data("TCS.NS"))
    for section in ("PRICE INFORMATION", "TECHNICALS", "VALUATION METRICS", "COMPANY HEALTH",
                    "VOLUME ACTIVITY", "ANALYST VIEW"):
        assert section in text
    assert "Revenue Growth (YoY) : 12.00%" in text
    assert "None" not in text


def test_bad_symbol_raises(fake_market):
    with pytest.raises(ValueError):
        fetcher.fetch_stock_data("BAD.NS")


def test_stock_detail_and_peers(fake_market):
    detail = fetcher.get_stock_detail("INFY.NS")
    assert detail["chart"]["candles"]
    assert detail["peers"] and all(p["symbol"] != "INFY.NS" for p in detail["peers"])
    assert "P/E" in fetcher.format_peers_for_agent(detail["peers"])
    assert "Quarter" in fetcher.format_financials_for_agent(detail["financials"])


def test_ttl_cache_returns_copies():
    from data.cache import clear_cache, ttl_cache
    calls = []

    @ttl_cache(60)
    def f(x):
        calls.append(x)
        return {"v": [x]}

    clear_cache()
    a = f(1)
    a["v"].append(99)
    assert f(1) == {"v": [1]}
    assert calls == [1]
