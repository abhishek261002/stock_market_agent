// =============================================================================
// /watchlist — tracked stocks, AI re-analysis, price alerts
// =============================================================================

import { useState } from "react"
import { Link } from "react-router-dom"
import { Trash } from "@phosphor-icons/react"
import { SymbolPicker } from "../components/SymbolPicker"
import { Change, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Skeleton, Spinner, VerdictBadge } from "../components/ui"
import { useAsync } from "../hooks/useAsync"
import { api } from "../lib/api"
import { inr, ticker, timeAgo } from "../lib/format"

export default function Watchlist() {
  const list = useAsync(() => api.watchlist(), [])
  const alerts = useAsync(() => api.priceAlerts(), [])
  const [msg, setMsg] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const add = async (s: string) => { await api.watch(s); list.reload(true) }
  const remove = async (s: string) => {
    list.setData(d => d?.filter(x => x.symbol !== s) ?? null)
    await api.unwatch(s)
  }
  const refreshAll = async () => {
    setRefreshing(true)
    const r = await api.refreshWatchlist()
    setMsg(r.status === "started"
      ? "Re-analysis started in the background, one debate round per stock. Changed verdicts will appear in alerts."
      : "A re-analysis is already running.")
    setTimeout(() => setRefreshing(false), 1500)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Watchlist" sub="Re-analysed each weekday after the close. You are alerted when a verdict changes."
        right={
          <>
            <SymbolPicker placeholder="Add a stock" onPick={add} />
            <button onClick={refreshAll} disabled={refreshing || !list.data?.length} className="btn-secondary">
              {refreshing && <Spinner className="h-3.5 w-3.5" />}Re-analyse all
            </button>
          </>
        } />

      {msg && <p className="text-[13px] text-fg-2">{msg}</p>}
      {list.error && <ErrorNote message={list.error} onRetry={() => list.reload()} />}

      <Panel>
        {list.loading ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10" />)}</div>
        ) : !list.data?.length ? (
          <Empty title="Your watchlist is empty">Add stocks above, or use Watch on any stock page.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px] [&_td]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-line text-xs text-fg-3">
                  <th className="px-5 py-2 text-left font-normal">Stock</th>
                  <th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 text-left font-normal">Last verdict</th>
                  <th className="px-3 py-2 text-right font-normal">Price then</th>
                  <th className="px-3 py-2 text-right font-normal">Since</th>
                  <th className="px-3 py-2 text-left font-normal">Analysed</th>
                  <th className="px-5 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map(w => {
                  const a = w.last_analysis
                  return (
                    <tr key={w.symbol} className="row group">
                      <td className="px-5 py-2.5">
                        <Link to={`/stock/${encodeURIComponent(w.symbol)}`} className="num text-fg hover:underline">{ticker(w.symbol)}</Link>
                        <span className="ml-2 text-xs text-fg-3">{w.name}</span>
                      </td>
                      <td className="num px-3 py-2.5 text-right">{inr(w.price)}</td>
                      <td className="px-3 py-2.5">
                        {a ? <Link to={`/stock/${encodeURIComponent(w.symbol)}?analysis=${a.id}`}><VerdictBadge verdict={a.verdict} confidence={a.confidence} /></Link>
                          : <Link to={`/stock/${encodeURIComponent(w.symbol)}?debate=1`} className="text-xs text-fg-2 underline underline-offset-4">Run analysis</Link>}
                      </td>
                      <td className="num px-3 py-2.5 text-right text-fg-2">{a ? inr(a.price) : "-"}</td>
                      <td className="px-3 py-2.5 text-right">{w.change_since_analysis_pct !== undefined ? <Change value={w.change_since_analysis_pct} /> : <span className="text-fg-3">-</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-fg-3">{a ? timeAgo(a.created_at) : "never"}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button aria-label={`Remove ${ticker(w.symbol)}`} onClick={() => remove(w.symbol)}
                          className="text-fg-3 opacity-0 transition-opacity hover:text-down group-hover:opacity-100 focus:opacity-100">
                          <Trash className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Price alerts" sub="Create alerts from a stock page. Checked every few minutes." />
        {alerts.data?.length ? (
          <table className="w-full text-[13px]">
            <tbody>
              {alerts.data.map(p => (
                <tr key={p.id} className="row group border-t border-line">
                  <td className="px-5 py-2.5"><Link to={`/stock/${encodeURIComponent(p.symbol)}`} className="num hover:underline">{ticker(p.symbol)}</Link></td>
                  <td className="px-3 py-2.5 text-fg-2">crosses {p.direction} <span className="num text-fg">{inr(p.price)}</span></td>
                  <td className="px-3 py-2.5 text-xs text-fg-3">{p.triggered_at ? `Triggered ${timeAgo(p.triggered_at)}` : "Active"}</td>
                  <td className="px-5 py-2.5 text-right">
                    <button aria-label="Delete alert" onClick={async () => { await api.deletePriceAlert(p.id); alerts.reload(true) }}
                      className="text-fg-3 opacity-0 transition-opacity hover:text-down group-hover:opacity-100 focus:opacity-100"><Trash className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-5 pb-5 text-[13px] text-fg-3">No price alerts.</p>}
      </Panel>
    </div>
  )
}
