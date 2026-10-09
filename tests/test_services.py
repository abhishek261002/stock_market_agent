import pytest

from agents.risk_agent import compute_risk_plan
from agents.schemas import AnalystReport, DebateArgument, ScreenerFilters
from services import screener
from services.market import market_status


ROWS = [
    {"symbol": "A.NS", "sector": "IT", "pe_ratio": 15, "price_to_book": 2, "return_on_equity": 25,
     "debt_to_equity": 0.1, "profit_margin": 20, "dividend_yield": 3, "rsi_14": 40, "change_1m_pct": 5,
     "change_1y_pct": 30, "change_3m_pct": 10, "rel_strength_3m": 4, "pct_from_52w_high": -2,
     "above_sma200": True, "market_cap": 5e12, "earnings_growth": 15, "revenue_growth": 12},
    {"symbol": "B.NS", "sector": "Banking", "pe_ratio": 35, "price_to_book": 6, "return_on_equity": 12,
     "debt_to_equity": 1.5, "profit_margin": 8, "dividend_yield": 0.5, "rsi_14": 72, "change_1m_pct": -3,
     "change_1y_pct": -10, "change_3m_pct": -5, "rel_strength_3m": -8, "pct_from_52w_high": -25,
     "above_sma200": False, "market_cap": 1e12, "earnings_growth": 2, "revenue_growth": 3},
    {"symbol": "C.NS", "sector": "IT", "pe_ratio": -5, "price_to_book": None, "return_on_equity": None,
     "debt_to_equity": None, "profit_margin": -4, "dividend_yield": None, "rsi_14": 28, "change_1m_pct": -12,
     "change_1y_pct": 5, "change_3m_pct": 0, "rel_strength_3m": 0, "pct_from_52w_high": -40,
     "above_sma200": False, "market_cap": 2e11, "earnings_growth": None, "revenue_growth": None},
]


def test_scores_are_percentiles():
    rows = screener.add_scores([dict(r) for r in ROWS])
    a, b = rows[0], rows[1]
    assert a["quality_score"] > b["quality_score"]
    assert a["value_score"] > b["value_score"]
    assert a["momentum_score"] > b["momentum_score"]
    assert all(0 <= r["overall_score"] <= 100 for r in rows)


def test_filters():
    f = screener.apply_filters
    assert [r["symbol"] for r in f(ROWS, {"sectors": ["IT"]})] == ["A.NS", "C.NS"]
    assert [r["symbol"] for r in f(ROWS, {"pe_max": 20})] == ["A.NS"]          # negative P/E excluded
    assert [r["symbol"] for r in f(ROWS, {"rsi_max": 35})] == ["C.NS"]
    assert [r["symbol"] for r in f(ROWS, {"above_sma200": True})] == ["A.NS"]
    assert [r["symbol"] for r in f(ROWS, {"near_52w_high_pct": 5})] == ["A.NS"]
    assert [r["symbol"] for r in f(ROWS, {"market_cap_min_cr": 50000})] == ["A.NS", "B.NS"]
    asc = f(ROWS, {"sort_by": "rsi_14", "sort_desc": False})
    assert [r["symbol"] for r in asc] == ["C.NS", "A.NS", "B.NS"]


def test_presets_are_valid_filters():
    for p in screener.PRESETS:
        ScreenerFilters(**p["filters"])


def test_parse_and_rank_with_fake_llm(fake_llm):
    f = screener.parse_query("profitable IT companies")
    assert f["sectors"] == ["IT"] and f["roe_min"] == 15
    ranked = screener.rank_shortlist([{"symbol": "TCS.NS", "name": "TCS", "sector": "IT"},
                                      {"symbol": "INFY.NS", "name": "Infosys", "sector": "IT"}], "quality")
    assert ranked["picks"][0]["symbol"] == "TCS.NS"


def test_score_normalisation():
    assert AnalystReport(stance="bullish", score=0.8, headline="h", summary="s", key_points=[]).score == 8.0
    assert DebateArgument(thesis="t", points=[], confidence=14).confidence == 10.0
    assert DebateArgument(thesis="t", points=[], confidence=1).confidence == 1.0


def _sd(**kw):
    base = {"current_price": 100.0, "tech_atr_14": 2.0, "tech_volatility_ann": 25, "tech_sma_50": 95,
            "tech_sma_200": 90, "tech_bb_lower": 96, "tech_bb_upper": 104, "week_52_low": 80, "week_52_high": 120,
            "target_price": 115}
    base.update(kw)
    return base


def test_risk_plan_buy():
    p = compute_risk_plan(_sd(), {"verdict": "BUY", "confidence": 8})
    assert p["stop_loss"] == 96.0 and p["target_1"] == 106.0 and p["target_2"] == 112.0
    assert p["risk_reward"] == 1.5
    assert p["position_size_pct"] == pytest.approx(16.0)       # min(20, 1%/4%=25) * 0.8
    assert p["volatility_regime"] == "medium"
    assert p["nearest_support"] == 96 and p["nearest_resistance"] == 104


def test_risk_plan_sell_and_hold():
    s = compute_risk_plan(_sd(), {"verdict": "SELL", "confidence": 7})
    assert s["stop_loss"] > s["entry"] > s["target_1"] and s["position_size_pct"] == 0
    h = compute_risk_plan(_sd(), {"verdict": "HOLD", "confidence": 6})
    assert h["stop_loss"] == 95.0 and h["position_size_pct"] < 10


def test_market_status():
    from datetime import datetime
    from services.market import IST
    assert market_status(datetime(2026, 10, 9, 11, 0, tzinfo=IST))["open"] is True       # Friday
    assert market_status(datetime(2026, 10, 10, 11, 0, tzinfo=IST))["open"] is False     # Saturday
    assert market_status(datetime(2026, 10, 9, 8, 0, tzinfo=IST))["label"] == "Pre-open"


def test_scheduler_next_refresh_skips_weekend():
    from datetime import datetime
    from services.market import IST
    from services.scheduler import seconds_until_next_refresh
    fri_evening = datetime(2026, 10, 9, 18, 0, tzinfo=IST)
    secs = seconds_until_next_refresh(fri_evening)
    assert 2 * 86400 < secs < 3 * 86400        # → Monday 16:15


def test_backtest_with_fake_llm(fake_llm, fake_market, monkeypatch):
    from services import backtest
    from tests.fakes import make_history
    long = make_history(n=480)
    bench = make_history(n=480, seed=11)
    monkeypatch.setattr(backtest, "get_history", lambda s, p="2y": bench.copy() if s.startswith("^") else long.copy())
    progress = []
    res = backtest.run_backtest("TCS.NS", points=6, horizon=21, progress=progress.append)
    m = res["metrics"]
    assert m["points"] == 6 and len(res["equity"]) == 6 and len(progress) == 6
    assert m["calls"]["BUY"] == 6                         # fake always says BUY
    assert m["ai_total_return"] == m["buy_hold_return"]   # always-long == buy & hold
    dates = [r["date"] for r in res["rows"]]
    assert dates == sorted(dates)
    for r in res["rows"]:
        assert r["exit_date"] > r["date"]


def test_compare_with_fake_llm(fake_llm, fake_market):
    from services.compare import compare_stocks
    res = compare_stocks(["TCS.NS", "INFY.NS"])
    assert res["verdict"]["winner"] == "TCS.NS"
    assert len(res["stocks"]) == 2 and res["performance"]["TCS.NS"][0]["value"] == 100.0
    with pytest.raises(ValueError):
        compare_stocks(["TCS.NS", "TCS.NS"])


def test_chat_context_and_stream(fake_llm, fake_market, temp_db):
    from services.analysis import run_and_save
    from services.chat import build_context, stream_answer
    a = run_and_save("TCS.NS", 1)
    assert "JUDGE VERDICT: BUY" in build_context(a)
    assert "".join(stream_answer(a, [{"role": "user", "content": "why?"}])) == "Fake streamed answer."
