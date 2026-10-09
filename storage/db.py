# =============================================================================
# storage/db.py
# =============================================================================
# SQLite persistence: analysis history (the judge's memory), watchlist,
# alerts, price alerts, backtest results and a small persistent key/value
# cache (used for the screener universe so it survives restarts).
#
# One short-lived connection per call keeps this thread-safe for FastAPI's
# thread pool. .NET ANALOGY: a repository class over Microsoft.Data.Sqlite.
# =============================================================================

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    id          TEXT PRIMARY KEY,
    symbol      TEXT NOT NULL,
    name        TEXT,
    created_at  TEXT NOT NULL,
    verdict     TEXT,
    confidence  REAL,
    price       REAL,
    rounds      INTEGER,
    bull_conf   REAL,
    bear_conf   REAL,
    payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_analyses_symbol ON analyses(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS watchlist (
    symbol    TEXT PRIMARY KEY,
    name      TEXT,
    added_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT,
    created_at  TEXT NOT NULL,
    read        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_alerts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL,
    direction     TEXT NOT NULL CHECK (direction IN ('above', 'below')),
    price         REAL NOT NULL,
    created_at    TEXT NOT NULL,
    triggered_at  TEXT
);

CREATE TABLE IF NOT EXISTS backtests (
    id          TEXT PRIMARY KEY,
    symbol      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    payload     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_cache (
    key         TEXT PRIMARY KEY,
    expires_at  REAL NOT NULL,
    value       TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _conn():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db() -> None:
    with _conn() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(_SCHEMA)


# =============================================================================
# ANALYSES
# =============================================================================

def save_analysis(result: dict) -> str:
    """Persists a finished analysis (the API's result payload). Returns its id."""
    aid = result.get("id") or uuid.uuid4().hex[:12]
    result["id"] = aid
    result.setdefault("created_at", _now())
    v = result.get("verdict") or {}
    debate = result.get("debate") or []
    last = {}
    for e in sorted(debate, key=lambda e: e["round"]):
        last[e["side"]] = e["argument"].get("confidence")
    data = result.get("stock_data") or {}
    with _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO analyses (id, symbol, name, created_at, verdict, confidence, price, rounds,"
            " bull_conf, bear_conf, payload) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (aid, result["symbol"], data.get("name"), result["created_at"], v.get("verdict"), v.get("confidence"),
             data.get("current_price"), result.get("rounds"), last.get("bull"), last.get("bear"),
             json.dumps(result, default=str)),
        )
    return aid


def get_analysis(aid: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT payload FROM analyses WHERE id = ?", (aid,)).fetchone()
    return json.loads(row["payload"]) if row else None


def list_analyses(symbol: Optional[str] = None, limit: int = 50) -> list[dict]:
    sql = ("SELECT id, symbol, name, created_at, verdict, confidence, price, rounds, bull_conf, bear_conf "
           "FROM analyses")
    args: list[Any] = []
    if symbol:
        sql += " WHERE symbol = ?"
        args.append(symbol)
    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with _conn() as con:
        return [dict(r) for r in con.execute(sql, args).fetchall()]


def delete_analysis(aid: str) -> bool:
    with _conn() as con:
        return con.execute("DELETE FROM analyses WHERE id = ?", (aid,)).rowcount > 0


def latest_analysis(symbol: str) -> Optional[dict]:
    rows = list_analyses(symbol, 1)
    return rows[0] if rows else None


def prior_calls_text(symbol: str, limit: int = 3) -> str:
    """The judge's memory: its last few calls on this stock, as prompt text."""
    rows = list_analyses(symbol, limit)
    if not rows:
        return "None — first analysis of this stock."
    return "\n".join(
        f"- {r['created_at'][:10]}: {r['verdict']} at {r['confidence']}/10 when price was ₹{r['price']}"
        for r in rows
    )


# =============================================================================
# WATCHLIST
# =============================================================================

def add_to_watchlist(symbol: str, name: Optional[str] = None) -> None:
    with _conn() as con:
        con.execute("INSERT OR IGNORE INTO watchlist (symbol, name, added_at) VALUES (?,?,?)",
                    (symbol, name, _now()))


def remove_from_watchlist(symbol: str) -> bool:
    with _conn() as con:
        return con.execute("DELETE FROM watchlist WHERE symbol = ?", (symbol,)).rowcount > 0


def get_watchlist() -> list[dict]:
    with _conn() as con:
        rows = [dict(r) for r in con.execute("SELECT * FROM watchlist ORDER BY added_at DESC").fetchall()]
    for r in rows:
        last = latest_analysis(r["symbol"])
        r["last_analysis"] = last
    return rows


def in_watchlist(symbol: str) -> bool:
    with _conn() as con:
        return con.execute("SELECT 1 FROM watchlist WHERE symbol = ?", (symbol,)).fetchone() is not None


# =============================================================================
# ALERTS
# =============================================================================

def add_alert(symbol: str, kind: str, title: str, message: str = "") -> int:
    with _conn() as con:
        cur = con.execute("INSERT INTO alerts (symbol, kind, title, message, created_at) VALUES (?,?,?,?,?)",
                          (symbol, kind, title, message, _now()))
        return int(cur.lastrowid)


def list_alerts(unread_only: bool = False, limit: int = 50) -> list[dict]:
    sql = "SELECT * FROM alerts"
    if unread_only:
        sql += " WHERE read = 0"
    sql += " ORDER BY id DESC LIMIT ?"
    with _conn() as con:
        return [dict(r) for r in con.execute(sql, (limit,)).fetchall()]


def mark_alerts_read(ids: Optional[list[int]] = None) -> None:
    with _conn() as con:
        if ids:
            con.executemany("UPDATE alerts SET read = 1 WHERE id = ?", [(i,) for i in ids])
        else:
            con.execute("UPDATE alerts SET read = 1")


def check_verdict_flip(symbol: str, new_verdict: str, new_conf: float, previous: Optional[dict]) -> Optional[int]:
    """Creates an alert when a watchlisted stock's verdict changes."""
    if not previous or not in_watchlist(symbol) or previous.get("verdict") in (None, new_verdict):
        return None
    return add_alert(symbol, "verdict_flip",
                     f"{symbol.split('.')[0]}: {previous['verdict']} → {new_verdict}",
                     f"The judge changed its call from {previous['verdict']} ({previous['confidence']}/10) "
                     f"to {new_verdict} ({new_conf}/10).")


# --- price alerts ---

def add_price_alert(symbol: str, direction: str, price: float) -> int:
    with _conn() as con:
        cur = con.execute("INSERT INTO price_alerts (symbol, direction, price, created_at) VALUES (?,?,?,?)",
                          (symbol, direction, price, _now()))
        return int(cur.lastrowid)


def list_price_alerts(active_only: bool = True) -> list[dict]:
    sql = "SELECT * FROM price_alerts"
    if active_only:
        sql += " WHERE triggered_at IS NULL"
    with _conn() as con:
        return [dict(r) for r in con.execute(sql + " ORDER BY id DESC").fetchall()]


def delete_price_alert(pid: int) -> bool:
    with _conn() as con:
        return con.execute("DELETE FROM price_alerts WHERE id = ?", (pid,)).rowcount > 0


def evaluate_price_alerts(prices: dict[str, float]) -> list[int]:
    """Fires (and closes) every active price alert whose condition is met."""
    fired = []
    for pa in list_price_alerts(active_only=True):
        p = prices.get(pa["symbol"])
        if p is None:
            continue
        hit = p >= pa["price"] if pa["direction"] == "above" else p <= pa["price"]
        if hit:
            with _conn() as con:
                con.execute("UPDATE price_alerts SET triggered_at = ? WHERE id = ?", (_now(), pa["id"]))
            fired.append(add_alert(pa["symbol"], "price",
                                   f"{pa['symbol'].split('.')[0]} crossed {pa['direction']} ₹{pa['price']:,.2f}",
                                   f"Last price ₹{p:,.2f}."))
    return fired


# =============================================================================
# BACKTESTS
# =============================================================================

def save_backtest(result: dict) -> str:
    bid = result.get("id") or uuid.uuid4().hex[:12]
    result["id"] = bid
    result.setdefault("created_at", _now())
    with _conn() as con:
        con.execute("INSERT OR REPLACE INTO backtests (id, symbol, created_at, payload) VALUES (?,?,?,?)",
                    (bid, result["symbol"], result["created_at"], json.dumps(result, default=str)))
    return bid


def list_backtests(limit: int = 20) -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT payload FROM backtests ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        p = json.loads(r["payload"])
        out.append({k: p.get(k) for k in ("id", "symbol", "created_at", "metrics", "horizon_days")})
    return out


def get_backtest(bid: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT payload FROM backtests WHERE id = ?", (bid,)).fetchone()
    return json.loads(row["payload"]) if row else None


# =============================================================================
# PERSISTENT KV CACHE
# =============================================================================

def cache_get(key: str) -> Optional[Any]:
    with _conn() as con:
        row = con.execute("SELECT expires_at, value FROM kv_cache WHERE key = ?", (key,)).fetchone()
    if not row or row["expires_at"] < time.time():
        return None
    return json.loads(row["value"])


def cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    with _conn() as con:
        con.execute("INSERT OR REPLACE INTO kv_cache (key, expires_at, value) VALUES (?,?,?)",
                    (key, time.time() + ttl_seconds, json.dumps(value, default=str)))
