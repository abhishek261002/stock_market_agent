// =============================================================================
// /history — every saved AI analysis
// =============================================================================

import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Trash } from "@phosphor-icons/react"
import { Empty, ErrorNote, PageHeader, Panel, Segmented, Skeleton, VerdictBadge } from "../components/ui"
import { useAsync } from "../hooks/useAsync"
import { api } from "../lib/api"
import { inr, ticker, timeAgo } from "../lib/format"
import type { Action } from "../lib/types"

export default function HistoryPage() {
  const list = useAsync(() => api.analyses(), [])
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<Action | "ALL">("ALL")

  const rows = useMemo(() => (list.data ?? []).filter(a =>
    (filter === "ALL" || a.verdict === filter) &&
    (!q || a.symbol.toLowerCase().includes(q.toLowerCase()) || (a.name ?? "").toLowerCase().includes(q.toLowerCase()))), [list.data, q, filter])
  const counts = useMemo(() => {
    const c = { BUY: 0, HOLD: 0, SELL: 0 }
    for (const a of list.data ?? []) if (a.verdict) c[a.verdict]++
    return c
  }, [list.data])

  const del = async (id: string) => {
    list.setData(d => d?.filter(x => x.id !== id) ?? null)
    await api.deleteAnalysis(id)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="History" sub="Every analysis is saved. The judge reads its earlier calls on a stock before giving a new one." />
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="hist-q" className="sr-only">Filter by stock</label>
        <input id="hist-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by stock" className="input max-w-60" />
        <Segmented label="Verdict" value={filter} onChange={setFilter} options={[
          { id: "ALL", label: `All ${list.data?.length ?? ""}` }, { id: "BUY", label: `Buy ${counts.BUY}` },
          { id: "HOLD", label: `Hold ${counts.HOLD}` }, { id: "SELL", label: `Sell ${counts.SELL}` },
        ]} />
      </div>
      {list.error && <ErrorNote message={list.error} onRetry={() => list.reload()} />}
      <Panel>
        {list.loading ? <div className="space-y-2 p-5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9" />)}</div>
          : rows.length === 0 ? <Empty title="Nothing here yet">Run an analysis from any stock page.</Empty>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-[13px] [&_td]:whitespace-nowrap">
                <thead><tr className="border-b border-line text-xs text-fg-3">
                  <th className="px-5 py-2 text-left font-normal">Stock</th><th className="px-3 py-2 text-left font-normal">Verdict</th>
                  <th className="px-3 py-2 text-right font-normal">Bull / bear</th><th className="px-3 py-2 text-right font-normal">Price then</th>
                  <th className="px-3 py-2 text-right font-normal">Rounds</th><th className="px-3 py-2 text-right font-normal">When</th>
                  <th className="px-5 py-2"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody>
                  {rows.map(a => (
                    <tr key={a.id} className="row group">
                      <td className="px-5 py-2.5">
                        <Link to={`/stock/${encodeURIComponent(a.symbol)}?analysis=${a.id}`} className="num text-fg hover:underline">{ticker(a.symbol)}</Link>
                        <span className="ml-2 text-xs text-fg-3">{a.name}</span>
                      </td>
                      <td className="px-3 py-2.5"><VerdictBadge verdict={a.verdict} confidence={a.confidence} /></td>
                      <td className="num px-3 py-2.5 text-right">
                        <span className="text-up">{a.bull_conf?.toFixed(1) ?? "-"}</span><span className="text-fg-3"> / </span>
                        <span className="text-down">{a.bear_conf?.toFixed(1) ?? "-"}</span>
                      </td>
                      <td className="num px-3 py-2.5 text-right">{inr(a.price)}</td>
                      <td className="num px-3 py-2.5 text-right text-fg-2">{a.rounds}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-fg-3">{timeAgo(a.created_at)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button aria-label="Delete analysis" onClick={() => del(a.id)}
                          className="text-fg-3 opacity-0 transition-opacity hover:text-down group-hover:opacity-100 focus:opacity-100"><Trash className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
    </div>
  )
}
