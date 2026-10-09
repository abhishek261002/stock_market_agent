import os
import sys
import warnings

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
warnings.filterwarnings("ignore")

from tests.fakes import FAKE_INFO, FakeLLM, make_history  # noqa: E402


@pytest.fixture
def fake_llm():
    """Routes every agent to FakeLLM. Returns the shared script dict for tweaking."""
    from agents import llm as llm_mod
    script: dict = {}
    llm_mod.set_llm_factory(lambda t: FakeLLM(t, script))
    yield script
    llm_mod.set_llm_factory(None)


@pytest.fixture
def fake_market(monkeypatch, tmp_path):
    """Replaces every Yahoo / Google News call with deterministic local data."""
    from data import cache, fetcher, news
    cache.clear_cache()
    hist = make_history()
    bench = make_history(seed=11, drift=0.0005)

    def history(symbol, period="1y"):
        if symbol == "BAD.NS":
            import pandas as pd
            return pd.DataFrame()
        return bench.copy() if symbol.startswith("^") else hist.copy()

    monkeypatch.setattr(fetcher, "get_history", history)
    monkeypatch.setattr(fetcher, "get_info", lambda s: dict(FAKE_INFO))
    monkeypatch.setattr(fetcher, "get_benchmark_close", lambda period="1y": bench["Close"].copy())
    fins = lambda s: [  # noqa: E731
        {"period": "Jun 2026", "revenue": 1e11, "net_income": 2e10, "operating_income": 2.5e10,
         "eps": 12.0, "net_margin_pct": 20.0, "op_margin_pct": 25.0}]
    monkeypatch.setattr(fetcher, "get_quarterly_financials", fins)
    from graph import pipeline
    monkeypatch.setattr(pipeline, "get_quarterly_financials", fins)
    from services import compare
    monkeypatch.setattr(compare, "get_history", history)
    fake_news = [{"title": "Testco wins big order", "source": "Mint", "published": "2026-10-08T10:00:00+00:00",
                  "link": "https://example.com/a"}]
    monkeypatch.setattr(news, "search_news", lambda q, limit=15: list(fake_news))
    from agents import news_agent
    monkeypatch.setattr(news_agent, "search_news", lambda q, limit=15: list(fake_news))
    yield {"history": hist, "bench": bench}
    cache.clear_cache()


@pytest.fixture
def temp_db(monkeypatch, tmp_path):
    from storage import db
    path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db()
    yield path
