# =============================================================================
# services/scheduler.py
# =============================================================================
# Background jobs started with the API (FastAPI lifespan):
#   1. Daily watchlist re-analysis after market close (weekdays, IST) — any
#      verdict change raises an alert.
#   2. Price-alert checks every PRICE_ALERT_INTERVAL_SEC.
# Plain asyncio loops — no extra dependency. .NET ANALOGY: IHostedService.
# =============================================================================

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from config import (PRICE_ALERT_INTERVAL_SEC, WATCHLIST_REFRESH_HOUR, WATCHLIST_REFRESH_MINUTE)
from services.analysis import run_and_save
from services.market import IST, latest_prices
from storage import db

_state = {"watchlist_running": False, "last_watchlist_run": None, "last_price_check": None}


def scheduler_state() -> dict:
    return dict(_state)


def seconds_until_next_refresh(now: datetime | None = None) -> float:
    now = (now or datetime.now(IST)).astimezone(IST)
    target = now.replace(hour=WATCHLIST_REFRESH_HOUR, minute=WATCHLIST_REFRESH_MINUTE, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    while target.weekday() >= 5:      # skip Saturday/Sunday
        target += timedelta(days=1)
    return (target - now).total_seconds()


def refresh_watchlist_sync(rounds: int = 1) -> dict:
    """Re-analyses every watchlist stock (1 debate round to save tokens)."""
    if _state["watchlist_running"]:
        return {"status": "already running"}
    _state["watchlist_running"] = True
    done, failed = [], []
    try:
        for item in db.get_watchlist():
            try:
                run_and_save(item["symbol"], rounds)
                done.append(item["symbol"])
            except Exception as e:
                print(f"[Scheduler] refresh failed for {item['symbol']}: {e}")
                failed.append(item["symbol"])
        _state["last_watchlist_run"] = datetime.now(IST).isoformat(timespec="seconds")
        if done:
            db.add_alert("WATCHLIST", "info", f"Watchlist refreshed ({len(done)} stocks)",
                         f"Failed: {', '.join(failed)}" if failed else "All stocks re-analysed.")
    finally:
        _state["watchlist_running"] = False
    return {"refreshed": done, "failed": failed}


def check_price_alerts_sync() -> list[int]:
    alerts = db.list_price_alerts(active_only=True)
    if not alerts:
        return []
    prices = latest_prices(tuple(sorted({a["symbol"] for a in alerts})))
    _state["last_price_check"] = datetime.now(IST).isoformat(timespec="seconds")
    return db.evaluate_price_alerts(prices)


async def _watchlist_loop():
    while True:
        await asyncio.sleep(seconds_until_next_refresh())
        await asyncio.to_thread(refresh_watchlist_sync)


async def _price_loop():
    while True:
        try:
            await asyncio.to_thread(check_price_alerts_sync)
        except Exception as e:
            print(f"[Scheduler] price check failed: {e}")
        await asyncio.sleep(PRICE_ALERT_INTERVAL_SEC)


def start(loop_tasks: list) -> None:
    loop_tasks.append(asyncio.create_task(_watchlist_loop()))
    loop_tasks.append(asyncio.create_task(_price_loop()))
    print("[Scheduler] started (watchlist refresh "
          f"{WATCHLIST_REFRESH_HOUR:02d}:{WATCHLIST_REFRESH_MINUTE:02d} IST weekdays; price alerts every "
          f"{PRICE_ALERT_INTERVAL_SEC}s)")
