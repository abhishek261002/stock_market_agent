from storage import db


def _analysis(symbol="INFY.NS", verdict="BUY", conf=7.0, price=1000.0):
    return {"symbol": symbol, "rounds": 2, "stock_data": {"name": "Infosys", "current_price": price},
            "verdict": {"verdict": verdict, "confidence": conf},
            "debate": [{"side": "bull", "round": 1, "argument": {"confidence": 7}},
                       {"side": "bull", "round": 2, "argument": {"confidence": 6}},
                       {"side": "bear", "round": 2, "argument": {"confidence": 5}}]}


def test_save_and_list_analyses(temp_db):
    aid = db.save_analysis(_analysis())
    got = db.get_analysis(aid)
    assert got["symbol"] == "INFY.NS"
    rows = db.list_analyses("INFY.NS")
    assert rows[0]["bull_conf"] == 6 and rows[0]["bear_conf"] == 5   # final-round confidences
    assert "BUY at 7.0/10" in db.prior_calls_text("INFY.NS")
    assert db.prior_calls_text("TCS.NS").startswith("None")
    assert db.delete_analysis(aid) and db.get_analysis(aid) is None


def test_verdict_flip_alert_only_for_watchlist(temp_db):
    prev = {"verdict": "HOLD", "confidence": 5}
    assert db.check_verdict_flip("INFY.NS", "BUY", 7, prev) is None       # not watched
    db.add_to_watchlist("INFY.NS", "Infosys")
    assert db.check_verdict_flip("INFY.NS", "HOLD", 6, prev) is None      # unchanged
    assert db.check_verdict_flip("INFY.NS", "BUY", 7, prev) is not None
    alerts = db.list_alerts()
    assert alerts[0]["kind"] == "verdict_flip" and "HOLD → BUY" in alerts[0]["title"]
    db.mark_alerts_read()
    assert db.list_alerts(unread_only=True) == []


def test_watchlist_roundtrip(temp_db):
    db.add_to_watchlist("TCS.NS")
    db.add_to_watchlist("TCS.NS")       # idempotent
    db.save_analysis(_analysis("TCS.NS"))
    wl = db.get_watchlist()
    assert len(wl) == 1 and wl[0]["last_analysis"]["verdict"] == "BUY"
    assert db.remove_from_watchlist("TCS.NS") and db.get_watchlist() == []


def test_price_alerts_fire_once(temp_db):
    pid = db.add_price_alert("INFY.NS", "above", 1500)
    db.add_price_alert("INFY.NS", "below", 900)
    assert db.evaluate_price_alerts({"INFY.NS": 1400}) == []
    fired = db.evaluate_price_alerts({"INFY.NS": 1550})
    assert len(fired) == 1
    assert db.evaluate_price_alerts({"INFY.NS": 1600}) == []           # already triggered
    assert len(db.list_price_alerts(active_only=True)) == 1
    assert db.delete_price_alert(pid)


def test_kv_cache_expiry(temp_db):
    db.cache_set("k", {"a": 1}, 60)
    assert db.cache_get("k") == {"a": 1}
    db.cache_set("old", 1, -1)
    assert db.cache_get("old") is None


def test_backtests(temp_db):
    bid = db.save_backtest({"symbol": "INFY.NS", "metrics": {"ai_hit_rate": 60}, "horizon_days": 21})
    assert db.get_backtest(bid)["metrics"]["ai_hit_rate"] == 60
    assert db.list_backtests()[0]["id"] == bid
