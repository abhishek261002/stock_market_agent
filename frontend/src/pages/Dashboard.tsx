// =============================================================================
// / — Markets overview
// =============================================================================

import { motion } from "motion/react"
import { Link, useNavigate } from "react-router-dom"
import { Change, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Skeleton, Sparkline, VerdictBadge } from "../components/ui"
import { useAsync } from "../hooks/useAsync"
import { api } from "../lib/api"
import { useAppData } from "../lib/appData"
import { cx, heat, inr, pct, ticker, timeAgo } from "../lib/format"
import type { MarketOverview } from "../lib/types"

function today() {
  return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })
}

export default function Dashboard() {
  const { market, marketError, refreshMarket } = useAppData()
  const recent = useAsync(() => api.analyses(), [])
  const watch = useAsync(() => api.watchlist(), [])

  return (
    <div className="space-y-4">
      <PageHeader title="Markets" sub={`${today()}. ${market ? `${market.status.label}.` : ""} Prices from Yahoo Finance, may be delayed.`}
        right={<Link to="/screener" className="btn-secondary">Open screener</Link>} />

      {marketError && !market && <ErrorNote message={`Market data is unavailable: ${marketError}`} onRetry={refreshMarket} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Indices" />
          {market ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-y border-line text-xs text-fg-3">
                  <th className="px-5 py-2 text-left font-normal">Index</th>
                  <th className="px-3 py-2 text-right font-normal">Level</th>
                  <th className="px-3 py-2 text-right font-normal">Today</th>
                  <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">1 month</th>
                  <th className="px-5 py-2 text-right font-normal">30 days</th>
                </tr>
              </thead>
              <tbody>
                {market.indices.map(ix => (
                  <tr key={ix.symbol} className="row">
                    <td className="px-5 py-2.5 text-fg">{ix.name}</td>
                    <td className="num px-3 py-2.5 text-right">{inr(ix.price, { symbol: ix.symbol === "USDINR=X" })}</td>
                    <td className="px-3 py-2.5 text-right"><Change value={ix.change_pct} /></td>
                    <td className="hidden px-3 py-2.5 text-right sm:table-cell"><Change value={ix.change_1m_pct} decimals={1} /></td>
                    <td className="px-5 py-2.5"><div className="flex justify-end"><Sparkline data={ix.sparkline} width={88} height={22} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="space-y-2 px-5 pb-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>}
        </Panel>

        <Panel>
          <PanelHeader title="Breadth" sub="Advancing against declining stocks in the covered universe" />
          {market ? <Breadth b={market.breadth} /> : <Skeleton className="mx-5 mb-5 h-16" />}
          <div className="border-t border-line">
            <PanelHeader title="Recent AI verdicts" right={<Link to="/history" className="text-xs text-fg-3 hover:text-fg">View all</Link>} />
            {recent.loading ? <div className="space-y-2 px-5 pb-5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-7" />)}</div>
              : recent.data?.length ? (
                <ul className="pb-2">
                  {recent.data.slice(0, 5).map(a => (
                    <li key={a.id}>
                      <Link to={`/stock/${encodeURIComponent(a.symbol)}?analysis=${a.id}`}
                        className="flex items-center gap-3 px-5 py-2 transition-colors hover:bg-surface-2">
                        <span className="num w-24 text-[13px] text-fg">{ticker(a.symbol)}</span>
                        <span className="flex-1 text-xs text-fg-3">{timeAgo(a.created_at)}, at {inr(a.price)}</span>
                        <VerdictBadge verdict={a.verdict} confidence={a.confidence} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="No verdicts yet">Open any stock and run an analysis.</Empty>}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Sectors" sub="Average move today. Hover a sector to see its biggest movers." />
        <div className="px-5 pb-5">{market ? <Heatmap market={market} /> : <Skeleton className="h-64" />}</div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Movers title="Top gainers" rows={market?.gainers} />
        <Movers title="Top losers" rows={market?.losers} />
      </div>

      {watch.data && watch.data.length > 0 && (
        <Panel>
          <PanelHeader title="Watchlist" right={<Link to="/watchlist" className="text-xs text-fg-3 hover:text-fg">Manage</Link>} />
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            {watch.data.slice(0, 12).map(w => (
              <Link key={w.symbol} to={`/stock/${encodeURIComponent(w.symbol)}`} className="bg-surface px-5 py-3.5 transition-colors hover:bg-surface-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[13px]">{ticker(w.symbol)}</span>
                  <VerdictBadge verdict={w.last_analysis?.verdict} />
                </div>
                <p className="num mt-1 text-[13px] text-fg-2">{inr(w.price)}</p>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function Heatmap({ market }: { market: MarketOverview }) {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      {market.sectors.map(s => (
        <div key={s.sector} className="group relative min-h-[84px] p-3" style={{ background: heat(s.change_pct) }}>
          <p className="text-[13px] text-fg">{s.sector}</p>
          <p className={cx("num mt-1 text-[15px]", s.change_pct >= 0 ? "text-up" : "text-down")}>{pct(s.change_pct)}</p>
          <p className="num text-[11px] text-fg-3">{pct(s.change_1m_pct, { decimals: 1 })} this month</p>
          <div className="pointer-events-none absolute inset-0 bg-surface p-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            {s.stocks.slice(0, 4).map(st => (
              <button key={st.symbol} onClick={() => navigate(`/stock/${encodeURIComponent(st.symbol)}`)}
                className="flex w-full items-center justify-between rounded px-1.5 py-0.5 text-xs hover:bg-surface-2">
                <span className="num text-fg">{ticker(st.symbol)}</span>
                <span className={cx("num", st.change_pct >= 0 ? "text-up" : "text-down")}>{pct(st.change_pct)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Breadth({ b }: { b: MarketOverview["breadth"] }) {
  const adv = (b.advancers / (b.total || 1)) * 100
  const dec = (b.decliners / (b.total || 1)) * 100
  return (
    <div className="px-5 pb-5">
      <div className="num flex items-baseline justify-between">
        <span><span className="text-2xl text-up">{b.advancers}</span> <span className="text-xs text-fg-3">up</span></span>
        <span className="text-xs text-fg-3">{b.unchanged} flat</span>
        <span><span className="text-xs text-fg-3">down</span> <span className="text-2xl text-down">{b.decliners}</span></span>
      </div>
      <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <motion.div className="bg-up" initial={{ width: 0 }} animate={{ width: `${adv}%` }} transition={{ duration: 0.6 }} />
        <div className="flex-1 bg-surface-3" />
        <motion.div className="bg-down" initial={{ width: 0 }} animate={{ width: `${dec}%` }} transition={{ duration: 0.6 }} />
      </div>
    </div>
  )
}

function Movers({ title, rows }: { title: string; rows?: MarketOverview["gainers"] }) {
  const navigate = useNavigate()
  return (
    <Panel>
      <PanelHeader title={title} sub="By change today" />
      {!rows ? <div className="space-y-2 px-5 pb-5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div> : (
        <table className="w-full text-[13px]">
          <tbody>
            {rows.map(r => (
              <tr key={r.symbol} onClick={() => navigate(`/stock/${encodeURIComponent(r.symbol)}`)} className="row cursor-pointer border-t border-line">
                <td className="px-5 py-2.5">
                  <span className="num text-fg">{ticker(r.symbol)}</span>
                  <span className="ml-2 hidden text-xs text-fg-3 sm:inline">{r.name}</span>
                </td>
                <td className="px-3 py-2.5"><Sparkline data={r.sparkline} width={72} height={20} /></td>
                <td className="num px-3 py-2.5 text-right">{inr(r.price)}</td>
                <td className="px-5 py-2.5 text-right"><Change value={r.change_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
