import time

import pytest
from langchain_core.runnables import RunnableLambda

from agents import llm
from agents.schemas import QuickCall


def test_limiter_blocks_when_window_full(monkeypatch):
    lim = llm.SlidingWindowLimiter(2)
    slept = []
    monkeypatch.setattr(llm.time, "sleep", lambda s: (slept.append(s), lim._calls.popleft()))
    waits = []
    token = llm.on_wait.set(waits.append)
    try:
        assert lim.acquire() == 0 and lim.acquire() == 0
        lim.acquire()                 # third call must wait for the window
    finally:
        llm.on_wait.reset(token)
    assert slept and 59 < slept[0] <= 60.2
    assert waits and waits[0] == pytest.approx(slept[0], abs=0.2)


def test_retry_honours_rate_limit_hint(monkeypatch):
    monkeypatch.setattr(llm, "acquire_slot", lambda: 0.0)
    penalties = []
    monkeypatch.setattr(llm._limiter, "penalise", penalties.append)
    calls = {"n": 0}

    def flaky(_):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("429 You exceeded your current quota. Please retry in 12.5s.")
        return QuickCall(verdict="BUY", confidence=7, rationale="ok")

    out = llm.invoke_with_retry(RunnableLambda(flaky), {}, schema=QuickCall)
    assert out.verdict == "BUY" and calls["n"] == 2
    assert penalties == [13.5]


def test_daily_quota_fails_fast(monkeypatch):
    monkeypatch.setattr(llm, "acquire_slot", lambda: 0.0)

    def boom(_):
        raise RuntimeError("429 quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier")
    t0 = time.time()
    with pytest.raises(RuntimeError, match="Daily Gemini quota"):
        llm.invoke_with_retry(RunnableLambda(boom), {})
    assert time.time() - t0 < 2


def test_dict_output_is_validated(monkeypatch):
    monkeypatch.setattr(llm, "acquire_slot", lambda: 0.0)
    out = llm.invoke_with_retry(RunnableLambda(lambda _: {"verdict": "SELL", "confidence": 0.4, "rationale": "x"}),
                                {}, schema=QuickCall)
    assert out.verdict == "SELL" and out.confidence == 4.0


def test_news_agent_executes_planned_searches(fake_llm, fake_market, monkeypatch):
    from agents import news_agent
    seen = []

    def fake_search(q, limit=15):
        seen.append(q)
        return [{"title": f"Headline for {q}", "source": "Mint", "published": None, "link": None}]
    monkeypatch.setattr(news_agent, "search_news", fake_search)
    report = news_agent.run_news_analysis("Testco Limited", "TST.NS", "IT")
    assert seen == ["Testco share price", "Testco sector regulation"]
    assert report["searches"] == seen
    assert report["research_reason"] == "Sector policy matters"
    assert len(report["headlines"]) == 2 and report["headlines"][0]["sentiment"] == "positive"


def test_em_dashes_are_scrubbed(monkeypatch):
    monkeypatch.setattr(llm, "acquire_slot", lambda: 0.0)
    out = llm.invoke_with_retry(RunnableLambda(lambda _: {"verdict": "BUY", "confidence": 7,
                                                         "rationale": "Strong trend — but stretched; range 10–20 – noted"}),
                                {}, schema=QuickCall)
    assert "—" not in out.rationale and out.rationale.startswith("Strong trend, but")
    assert "10–20" in out.rationale   # unspaced numeric ranges are left alone
