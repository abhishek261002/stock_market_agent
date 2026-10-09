# =============================================================================
# main.py — CLI entry point for the multi-agent debate pipeline
# =============================================================================
# Usage:  python main.py [SYMBOL] [ROUNDS]
#   e.g.  python main.py INFY.NS 2
# Runs the same LangGraph engine as the API and saves the result to history.
# =============================================================================

import sys

from data.universe import normalise_symbol
from services.analysis import run_and_save
from storage import db


def _progress(event: dict) -> None:
    if event.get("type") == "stage":
        rnd = f" (round {event['round']})" if event.get("round") else ""
        mark = {"running": "…", "done": "✓", "error": "✗"}.get(event["status"], "")
        took = f" {event['elapsed']}s" if event.get("elapsed") else ""
        print(f"  {mark} {event['stage']}{rnd}{took}")


def main():
    symbol = normalise_symbol(sys.argv[1]) if len(sys.argv) > 1 else "INFY.NS"
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 2

    print("\n" + "=" * 60)
    print("  Stock Screener Agent — Multi-Agent Bull vs Bear Debate")
    print(f"  Symbol: {symbol}   Rounds: {rounds}")
    print("=" * 60)

    db.init_db()
    try:
        result = run_and_save(symbol, rounds, emit=_progress)
    except ValueError as e:
        print(f"\n[ERROR] Pipeline failed: {e}")
        return

    for key, report in result["analyst_reports"].items():
        print(f"\n--- {key.upper()} ANALYST · {report['stance']} {report['score']}/10")
        print(f"  {report['headline']}")
        for p in report.get("key_points", []):
            print(f"   + {p}")

    for entry in result["debate"]:
        arg = entry["argument"]
        print(f"\n=== ROUND {entry['round']} · {entry['side'].upper()} ({arg['confidence']}/10) ===")
        print(f"  {arg['thesis']}")
        for p in arg["points"]:
            print(f"   • {p['title']}: {p['detail']}")
        if arg.get("rebuttal"):
            print(f"  ↳ Rebuttal: {arg['rebuttal']}")

    v = result["verdict"]
    print("\n" + "=" * 60)
    print(f"  JUDGE VERDICT: {v['verdict']}  ({v['confidence']}/10, {v['time_horizon']})")
    print("=" * 60)
    print(f"  {v['headline']}\n\n  {v['reasoning']}")
    print("\n  Key risks:", *[f"\n   - {r}" for r in v["key_risks"]])
    print(f"\n  Action: {v['suggested_action']}")

    r = result.get("risk_plan")
    if r:
        print(f"\n  Risk plan: entry ₹{r['entry']} · stop ₹{r['stop_loss']} · targets ₹{r['target_1']} / "
              f"₹{r['target_2']} · size {r['position_size_pct']}% · R:R {r['risk_reward']}")
    print(f"\n  Saved as analysis {result['id']} ({result['duration_sec']}s)")
    print(f"\n  {result['disclaimer']}")


if __name__ == "__main__":
    main()
