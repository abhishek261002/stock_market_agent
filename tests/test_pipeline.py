from graph.pipeline import route_after_round, run_analysis


def test_full_pipeline_runs_and_emits_events(fake_llm, fake_market):
    events = []
    state = run_analysis("TCS.NS", max_rounds=2, emit=events.append)

    assert state.get("error") is None
    assert set(state["analyst_reports"]) == {"fundamentals", "technical", "news"}
    assert state["final_verdict"]["verdict"] == "BUY"
    assert state["risk_plan"]["stop_loss"] < state["risk_plan"]["entry"]
    # two full rounds, one argument per side per round
    assert sorted((e["side"], e["round"]) for e in state["debate"]) == [
        ("bear", 1), ("bear", 2), ("bull", 1), ("bull", 2)]
    # round-2 arguments carry a rebuttal, round-1 ones don't
    r1 = [e for e in state["debate"] if e["round"] == 1]
    r2 = [e for e in state["debate"] if e["round"] == 2]
    assert all(e["argument"]["rebuttal"] is None for e in r1)
    assert all(e["argument"]["rebuttal"] for e in r2)

    done = [(e["stage"]) for e in events if e.get("type") == "stage" and e["status"] == "done"]
    for stage in ("fetch_data", "fundamentals", "technical", "news", "bull", "bear", "judge", "risk"):
        assert stage in done
    assert any(e.get("type") == "round_end" and e["round"] == 2 for e in events)
    # news headlines are enriched with sentiment from the structured report
    assert state["analyst_reports"]["news"]["headlines"][0]["sentiment"] == "positive"


def test_single_round(fake_llm, fake_market):
    state = run_analysis("TCS.NS", max_rounds=1)
    assert len(state["debate"]) == 2
    assert state["round"] == 1


def test_debate_converges_early(fake_llm, fake_market):
    # confidences barely move between rounds 1 and 2 → stop after 2 of 4 rounds
    fake_llm["bull_confidences"] = [7.0, 7.2, 5.0, 5.0]
    fake_llm["bear_confidences"] = [5.0, 5.1, 8.0, 8.0]
    state = run_analysis("TCS.NS", max_rounds=4)
    assert state["round"] == 2
    assert len(state["debate"]) == 4


def test_debate_continues_when_scores_move(fake_llm, fake_market):
    fake_llm["bull_confidences"] = [8.0, 6.0, 5.0]
    fake_llm["bear_confidences"] = [5.0, 7.0, 7.1]
    state = run_analysis("TCS.NS", max_rounds=3)
    assert state["round"] == 3


def test_bad_symbol_ends_graph_with_error(fake_llm, fake_market):
    events = []
    state = run_analysis("BAD.NS", emit=events.append)
    assert "No data found" in state["error"]
    assert state.get("final_verdict") is None
    assert any(e.get("status") == "error" and e["stage"] == "fetch_data" for e in events)


def test_analyst_failure_is_non_fatal(fake_llm, fake_market, monkeypatch):
    from graph import pipeline

    def boom(*a, **k):
        raise RuntimeError("quota exceeded")
    monkeypatch.setattr(pipeline, "run_technical_analysis", boom)
    # the node closure captured the original function; rebuild through module attribute
    monkeypatch.setattr(pipeline, "technical_node", pipeline._analyst_node(
        "technical", "Technical", lambda s: pipeline.run_technical_analysis(s["stock_data_text"])))
    monkeypatch.setattr(pipeline, "_compiled", None)
    state = run_analysis("TCS.NS", max_rounds=1)
    monkeypatch.setattr(pipeline, "_compiled", None)
    assert state["analyst_reports"]["technical"]["failed"] is True
    assert state["final_verdict"] is not None
    assert any("quota" in w for w in state["warnings"])


def test_route_after_round_respects_max():
    debate = [{"side": s, "round": 1, "argument": {"confidence": 5}} for s in ("bull", "bear")]
    assert route_after_round({"round": 1, "max_rounds": 1, "debate": debate}) == "judge"
    assert route_after_round({"round": 1, "max_rounds": 3, "debate": debate}) == ["bull", "bear"]
