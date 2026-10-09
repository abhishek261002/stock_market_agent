import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(fake_llm, fake_market, temp_db, monkeypatch):
    import config
    monkeypatch.setattr(config, "SCHEDULER_ENABLED", False)
    from api import main as api
    monkeypatch.setattr(api, "SCHEDULER_ENABLED", False)
    api._hits.clear()
    # sse-starlette keeps a module-global exit Event bound to the first event loop;
    # each TestClient starts a new loop, so reset it (production has a single loop).
    from sse_starlette.sse import AppStatus
    AppStatus.should_exit_event = None
    with TestClient(api.app) as c:
        yield c


def sse_events(resp) -> list[dict]:
    out = []
    for line in resp.iter_lines():
        if line.startswith("data:"):
            out.append(json.loads(line[5:].strip()))
    return out


def test_health_and_config(client):
    assert client.get("/api/health").json()["status"] == "ok"
    cfg = client.get("/api/config").json()
    assert cfg["max_rounds"] >= cfg["default_rounds"] >= 1 and "SEBI" in cfg["disclaimer"]


def test_search(client):
    assert client.get("/api/search", params={"q": "infy"}).json()[0]["symbol"] == "INFY.NS"
    assert client.get("/api/search", params={"q": "zzzz"}).json()[0]["symbol"] == "ZZZZ.NS"


def test_invalid_symbol_rejected(client):
    assert client.post("/api/analyse", json={"symbol": "DROP TABLE;"}).status_code == 400
    assert client.post("/api/analyse", json={"symbol": "INFY", "rounds": 9}).status_code == 422


def test_stock_detail(client):
    r = client.get("/api/stock/INFY.NS")
    assert r.status_code == 200
    body = r.json()
    assert body["data"]["symbol"] == "INFY.NS" and body["chart"]["candles"] and body["in_watchlist"] is False
    assert client.get("/api/stock/BAD.NS").status_code == 404


def test_analyse_stream_persists_and_chat(client):
    with client.stream("POST", "/api/analyse", json={"symbol": "infy", "rounds": 2}) as r:
        assert r.status_code == 200
        events = sse_events(r)
    stages = {(e["stage"], e["status"]) for e in events if e.get("type") == "stage"}
    assert ("judge", "done") in stages and ("news", "done") in stages
    final = events[-1]
    assert final["type"] == "complete"
    result = final["result"]
    assert result["symbol"] == "INFY.NS" and result["verdict"]["verdict"] == "BUY" and result["rounds"] == 2

    hist = client.get("/api/analyses").json()
    assert hist[0]["id"] == result["id"]
    assert client.get(f"/api/analyses/{result['id']}").json()["risk_plan"]["entry"] > 0

    with client.stream("POST", "/api/chat", json={"analysis_id": result["id"],
                                                  "messages": [{"role": "user", "content": "why?"}]}) as r:
        chat = sse_events(r)
    assert "".join(e["text"] for e in chat if e["type"] == "token") == "Fake streamed answer."
    assert client.post("/api/chat", json={"analysis_id": "nope",
                                          "messages": [{"role": "user", "content": "x"}]}).status_code == 404


def test_analyse_error_event(client):
    with client.stream("POST", "/api/analyse", json={"symbol": "BAD.NS"}) as r:
        events = sse_events(r)
    assert events[-1]["type"] == "error" and "No data found" in events[-1]["message"]


def test_rate_limit(client, monkeypatch):
    from api import main as api
    for _ in range(5):
        api.rate_limit(type("R", (), {"client": None})(), "backtest", 5)
    with pytest.raises(Exception) as e:
        api.rate_limit(type("R", (), {"client": None})(), "backtest", 5)
    assert "429" in str(e.value.status_code)


def test_watchlist_and_alerts(client, monkeypatch):
    from api import main as api
    monkeypatch.setattr(api, "latest_prices", lambda syms: {s: 123.0 for s in syms})
    assert client.post("/api/watchlist", json={"symbol": "tcs"}).json()["added"] == "TCS.NS"
    wl = client.get("/api/watchlist").json()
    assert wl[0]["symbol"] == "TCS.NS" and wl[0]["price"] == 123.0
    pid = client.post("/api/price-alerts", json={"symbol": "TCS", "direction": "above", "price": 100}).json()["id"]
    assert any(p["id"] == pid for p in client.get("/api/price-alerts").json())
    assert client.delete(f"/api/price-alerts/{pid}").status_code == 200
    assert client.delete("/api/watchlist/TCS.NS").json()["removed"] == "TCS.NS"
    assert client.get("/api/alerts").json()["unread"] == 0


def test_screener_endpoints(client, monkeypatch):
    from services import screener
    rows = screener.add_scores([{"symbol": "TCS.NS", "name": "TCS", "sector": "IT", "pe_ratio": 20},
                                {"symbol": "INFY.NS", "name": "Infosys", "sector": "IT", "pe_ratio": 18}])
    from api import main as api
    monkeypatch.setattr(api, "build_universe", lambda progress=None, force=False: {"rows": rows, "sectors": ["IT"]})
    with client.stream("GET", "/api/screener/universe") as r:
        events = sse_events(r)
    assert events[-1]["type"] == "complete" and len(events[-1]["result"]["rows"]) == 2
    assert len(client.get("/api/screener/presets").json()) >= 5
    assert client.post("/api/screener/parse", json={"query": "quality IT"}).json()["roe_min"] == 15
    rank = client.post("/api/screener/rank", json={"symbols": ["TCS", "INFY"], "query": "q"}).json()
    assert rank["picks"][0]["symbol"] == "TCS.NS"


def test_compare_and_backtest_endpoints(client, monkeypatch):
    r = client.post("/api/compare", json={"symbols": ["TCS", "INFY"]})
    assert r.status_code == 200 and r.json()["verdict"]["winner"] == "TCS.NS"
    assert client.post("/api/compare", json={"symbols": ["TCS"]}).status_code == 422

    from services import backtest
    from tests.fakes import make_history
    long = make_history(n=480)
    monkeypatch.setattr(backtest, "get_history", lambda s, p="2y": long.copy())
    with client.stream("POST", "/api/backtest", json={"symbol": "TCS", "points": 4}) as r:
        events = sse_events(r)
    assert events[-1]["type"] == "complete"
    bid = events[-1]["result"]["id"]
    assert client.get(f"/api/backtests/{bid}").json()["metrics"]["points"] == 4
    assert client.get("/api/backtests").json()[0]["id"] == bid


def test_nan_is_sanitised():
    from api.main import safe
    assert safe({"a": float("nan"), "b": [float("inf"), 1.5]}) == {"a": None, "b": [None, 1.5]}
