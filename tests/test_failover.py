import pytest

from agents import llm
from agents.schemas import AnalystReport, QuickCall


class _Client:
    def __init__(self, name, behaviour):
        self.name, self.behaviour = name, behaviour

    def with_structured_output(self, schema):
        from langchain_core.runnables import RunnableLambda

        def run(_):
            b = self.behaviour[self.name]
            if isinstance(b, Exception):
                raise b
            return QuickCall(verdict=b, confidence=7, rationale=self.name)
        return RunnableLambda(run)


@pytest.fixture
def chain(monkeypatch):
    import config
    monkeypatch.setattr(config, "LLM_MODEL", "m1")
    monkeypatch.setattr(config, "LLM_FALLBACK_MODELS", ["m2", "m3"])
    monkeypatch.setenv("GOOGLE_API_KEY", "x")
    monkeypatch.delenv("LLM_MOCK", raising=False)
    llm._exhausted.clear()
    behaviour: dict = {}
    monkeypatch.setattr(llm, "_client", lambda m, t: _Client(m, behaviour))
    yield behaviour
    llm._exhausted.clear()


def test_fails_over_on_daily_quota_and_remembers(chain):
    chain.update({"m1": RuntimeError("429 GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
                  "m2": RuntimeError("404 models/m2 is no longer available"), "m3": "SELL"})
    out = llm.ResilientChat(0.1).with_structured_output(QuickCall).invoke("x")
    assert out.rationale == "m3"
    assert llm.model_status()["active"] == "m3"
    assert set(llm.model_status()["exhausted"]) == {"m1", "m2"}


def test_per_minute_429_is_not_failover(chain):
    chain.update({"m1": RuntimeError("429 GenerateRequestsPerMinutePerProjectPerModel"), "m2": "BUY"})
    with pytest.raises(RuntimeError, match="PerMinute"):
        llm.ResilientChat(0.1).with_structured_output(QuickCall).invoke("x")
    assert llm.model_status()["exhausted"] == []


def test_all_exhausted_gives_clear_error(chain):
    for m in ("m1", "m2", "m3"):
        chain[m] = RuntimeError("429 PerDay quota")
    with pytest.raises(RuntimeError, match="every configured model"):
        llm.ResilientChat(0.1).with_structured_output(QuickCall).invoke("x")


def test_demo_mode_uses_mock(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    from agents.mock_llm import FakeLLM
    m = llm.get_llm(0.2)
    assert isinstance(m, FakeLLM) and m.latency
    assert llm.acquire_slot() == 0.0


def test_bullets_are_cleaned():
    r = AnalystReport(stance="neutral", score=5, headline="h", summary="s",
                      key_points=["1. First point", "- second", "-22% drawdown in 6M", "3.5% growth", " "])
    assert r.key_points == ["First point", "second", "-22% drawdown in 6M", "3.5% growth"]
