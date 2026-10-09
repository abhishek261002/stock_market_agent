// =============================================================================
// /backtest — how would the AI's past calls have done?
// =============================================================================

import { useState } from "react"
import { Check, X } from "@phosphor-icons/react"
import { MultiLineChart, SeriesLegend, type LineSeriesSpec } from "../components/charts"
import { SymbolPicker } from "../components/SymbolPicker"
import { Empty, ErrorNote, PageHeader, Panel, PanelHeader, Segmented, Spinner, VerdictBadge } from "../components/ui"
import { useAsync } from "../hooks/useAsync"
import { api, streamEvents } from "../lib/api"
import { clean, cx, dateShort, inr, pct, ticker, timeAgo, upDown } from "../lib/format"
import type { BacktestResult } from "../lib/types"

export default function Backtest() {
  const [symbol, setSymbol] = useState("INFY.NS")
  const [points, setPoints] = useState(8)
  const [horizon, setHorizon] = useState(21)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const past = useAsync(() => api.backtests(), [])

  const run = async () => {
    setBusy(true); setErr(null); setResult(null); setProg({ done: 0, total: points })
    try {
      await streamEvents("/backtest", e => {
        if (e.type === "progress") setProg({ done: Number(e.done), total: Number(e.total) })
        if (e.type === "complete") { setResult(e.result as BacktestResult); past.reload(true) }
        if (e.type === "error") setErr(e.message ?? "The backtest failed.")
      }, { body: { symbol, points, horizon } })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false); setProg(null) }
  }

  const m = result?.metrics
  const series: LineSeriesSpec[] = result ? [
    { name: "AI calls", tokenName: "accent", width: 2, data: result.equity.map(e => ({ time: e.date, value: e.ai })) },
    { name: "Rule baseline", tokenName: "fg-2", style: "dashed", data: result.equity.map(e => ({ time: e.date, value: e.rule })) },
    { name: "Buy and hold", tokenName: "fg", data: result.equity.map(e => ({ time: e.date, value: e.buy_hold })) },
    { name: "Nifty 50", tokenName: "fg-3", style: "dotted", data: result.equity.map(e => ({ time: e.date, value: e.nifty })) },
  ] : []

  return (
    <div className="space-y-4">
      <PageHeader title="Backtest" sub="Replays the AI on past dates using only the price data available then, and checks what happened next." />

      <Panel className="flex flex-wrap items-end gap-x-6 gap-y-4 p-4">
        <div>
          <p className="label mb-1.5">Stock</p>
          <div className="flex items-center gap-2">
            <span className="num flex h-9 items-center rounded-md border border-line-strong bg-surface-2 px-3 text-[13px]">{ticker(symbol)}</span>
            <SymbolPicker placeholder="Change" onPick={setSymbol} />
          </div>
        </div>
        <div>
          <p className="label mb-1.5">Decision dates</p>
          <Segmented label="Decision dates" value={points} onChange={setPoints} options={[6, 8, 12].map(n => ({ id: n, label: String(n) }))} />
        </div>
        <div>
          <p className="label mb-1.5">Holding period</p>
          <Segmented label="Holding period" value={horizon} onChange={setHorizon} options={[10, 21, 42].map(n => ({ id: n, label: `${n} days` }))} />
        </div>
        <button onClick={run} disabled={busy} className="btn-primary ml-auto">
          {busy && <Spinner className="h-3.5 w-3.5" />}{busy ? `Running ${prog?.done ?? 0} of ${prog?.total ?? points}` : "Run backtest"}
        </button>
      </Panel>

      {err && <ErrorNote message={err} onRetry={run} />}

      {result && m && (
        <>
          <Panel>
            <dl className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
              <Metric label="AI hit rate" value={`${m.ai_hit_rate.toFixed(0)}%`} sub={`Rule baseline ${m.rule_hit_rate.toFixed(0)}%`} />
              <Metric label="AI strategy return" value={pct(m.ai_total_return, { decimals: 1 })} tone={m.ai_total_return} sub={`Rule baseline ${pct(m.rule_total_return, { decimals: 1 })}`} />
              <Metric label="Buy and hold" value={pct(m.buy_hold_return, { decimals: 1 })} tone={m.buy_hold_return} sub={`Nifty 50 ${pct(m.nifty_return, { decimals: 1 })}`} />
              <Metric label="Average excess on buys" value={m.avg_excess_on_buy === null ? "-" : pct(m.avg_excess_on_buy)} tone={m.avg_excess_on_buy ?? 0}
                sub={`${m.calls.BUY} buy, ${m.calls.HOLD} hold, ${m.calls.SELL} sell`} />
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title={`Growth of ₹100, ${ticker(result.symbol)}`} sub={`${result.horizon_days}-day holding periods. Long only; Hold and Sell mean cash.`}
              right={<SeriesLegend series={series} />} />
            <div className="px-2 pb-3"><MultiLineChart height={300} series={series} /></div>
          </Panel>

          <Panel>
            <PanelHeader title="Calls" sub="Each call against the stock's return over the Nifty in the following period" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px] [&_td]:whitespace-nowrap">
                <thead><tr className="border-y border-line text-xs text-fg-3">
                  <th className="px-5 py-2 text-left font-normal">Date</th><th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 text-left font-normal">AI call</th><th className="px-3 py-2 text-left font-normal">Reason</th>
                  <th className="px-3 py-2 text-left font-normal">Rule</th><th className="px-3 py-2 text-right font-normal">Stock</th>
                  <th className="px-3 py-2 text-right font-normal">vs Nifty</th><th className="px-5 py-2 text-center font-normal">Correct</th>
                </tr></thead>
                <tbody>
                  {result.rows.map(r => (
                    <tr key={r.date} className="row">
                      <td className="num px-5 py-2 text-fg-2">{dateShort(r.date)}</td>
                      <td className="num px-3 py-2 text-right">{inr(r.price)}</td>
                      <td className="px-3 py-2"><VerdictBadge verdict={r.ai_call} confidence={r.ai_confidence} /></td>
                      <td className="max-w-[320px] truncate px-3 py-2 text-fg-2" title={r.ai_rationale}>{clean(r.ai_rationale)}</td>
                      <td className="px-3 py-2"><VerdictBadge verdict={r.rule_call} /></td>
                      <td className={cx("num px-3 py-2 text-right", upDown(r.fwd_return_pct))}>{pct(r.fwd_return_pct, { decimals: 1 })}</td>
                      <td className={cx("num px-3 py-2 text-right", upDown(r.excess_pct))}>{pct(r.excess_pct, { decimals: 1 })}</td>
                      <td className="px-5 py-2">
                        {r.ai_correct
                          ? <Check aria-label="Correct" className="mx-auto h-3.5 w-3.5 text-up" weight="bold" />
                          : <X aria-label="Wrong" className="mx-auto h-3.5 w-3.5 text-down" weight="bold" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <section className="max-w-[80ch] text-[13px] text-fg-2">
            <h2 className="font-medium text-fg">Limits of this test</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">{result.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </section>
        </>
      )}

      {!result && !busy && (
        <Panel>
          <PanelHeader title="Previous backtests" />
          {past.data?.length ? (
            <table className="w-full text-[13px]">
              <tbody>
                {past.data.map(b => (
                  <tr key={b.id} className="row cursor-pointer border-t border-line" onClick={() => api.backtest(b.id).then(setResult)}>
                    <td className="num px-5 py-2.5">{ticker(b.symbol)}</td>
                    <td className="px-3 py-2.5 text-fg-3">{timeAgo(b.created_at)}, {b.metrics.points} dates, {b.horizon_days} days</td>
                    <td className="num px-3 py-2.5 text-right text-fg-2">hit rate {b.metrics.ai_hit_rate.toFixed(0)}%</td>
                    <td className={cx("num px-5 py-2.5 text-right", upDown(b.metrics.ai_total_return))}>{pct(b.metrics.ai_total_return, { decimals: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty title="No backtests yet">Pick a stock above and run one.</Empty>}
        </Panel>
      )}
    </div>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: number }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="label">{label}</dt>
      <dd className={cx("num mt-1 text-2xl", tone === undefined ? "text-fg" : upDown(tone))}>{value}</dd>
      <dd className="mt-1 text-xs text-fg-3">{sub}</dd>
    </div>
  )
}
