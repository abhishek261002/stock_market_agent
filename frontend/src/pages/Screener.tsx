// =============================================================================
// /screener — universe scan, plain-English screening, presets, AI ranking
// =============================================================================

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowDown, ArrowUp, CaretDown, X } from "@phosphor-icons/react"
import { Change, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Skeleton, Sparkline, Spinner } from "../components/ui"
import { useAsync } from "../hooks/useAsync"
import { api, streamEvents } from "../lib/api"
import { clean, crore, cx, inr, isNum, num, pct, ticker } from "../lib/format"
import type { RankedPick, ScreenerFilters, ScreenerRow } from "../lib/types"

const EMPTY: ScreenerFilters = { sectors: [], sort_by: "market_cap", sort_desc: true }

type NumKey = "pe_max" | "pb_max" | "roe_min" | "de_max" | "revenue_growth_min" | "profit_margin_min" | "dividend_yield_min"
  | "rsi_min" | "rsi_max" | "change_1y_min" | "market_cap_min_cr" | "near_52w_high_pct"
const FIELDS: { key: NumKey; label: string; ph: string }[] = [
  { key: "pe_max", label: "P/E at most", ph: "25" }, { key: "pb_max", label: "P/B at most", ph: "4" },
  { key: "roe_min", label: "ROE at least, %", ph: "15" }, { key: "de_max", label: "Debt/equity at most", ph: "0.5" },
  { key: "revenue_growth_min", label: "Revenue growth at least, %", ph: "10" }, { key: "profit_margin_min", label: "Net margin at least, %", ph: "10" },
  { key: "dividend_yield_min", label: "Dividend yield at least, %", ph: "2" }, { key: "change_1y_min", label: "1Y return at least, %", ph: "10" },
  { key: "rsi_min", label: "RSI at least", ph: "30" }, { key: "rsi_max", label: "RSI at most", ph: "70" },
  { key: "market_cap_min_cr", label: "Market cap at least, ₹ Cr", ph: "50000" }, { key: "near_52w_high_pct", label: "Within % of 52W high", ph: "5" },
]

// Mirrors services/screener.py apply_filters
function applyFilters(rows: ScreenerRow[], f: ScreenerFilters): ScreenerRow[] {
  const range: [keyof ScreenerFilters, keyof ScreenerRow, boolean][] = [
    ["pe_min", "pe_ratio", true], ["pe_max", "pe_ratio", false], ["pb_max", "price_to_book", false],
    ["roe_min", "return_on_equity", true], ["de_max", "debt_to_equity", false],
    ["revenue_growth_min", "revenue_growth", true], ["profit_margin_min", "profit_margin", true],
    ["dividend_yield_min", "dividend_yield", true], ["rsi_min", "rsi_14", true], ["rsi_max", "rsi_14", false],
    ["change_1m_min", "change_1m_pct", true], ["change_1m_max", "change_1m_pct", false], ["change_1y_min", "change_1y_pct", true],
  ]
  const out = rows.filter(r => {
    if (f.sectors.length && !f.sectors.includes(r.sector)) return false
    for (const [fk, rk, isMin] of range) {
      const bound = f[fk] as number | null | undefined
      if (!isNum(bound)) continue
      const v = r[rk] as number | null | undefined
      if (!isNum(v)) return false
      if (String(fk).startsWith("pe_") && v <= 0) return false
      if (isMin ? v < bound : v > bound) return false
    }
    if (isNum(f.market_cap_min_cr) && (r.market_cap ?? 0) < f.market_cap_min_cr * 1e7) return false
    if (f.above_sma200 !== null && f.above_sma200 !== undefined && r.above_sma200 !== f.above_sma200) return false
    if (isNum(f.near_52w_high_pct) && (!isNum(r.pct_from_52w_high) || r.pct_from_52w_high < -Math.abs(f.near_52w_high_pct))) return false
    return true
  })
  const k = f.sort_by
  return out.sort((a, b) => {
    const va = a[k] as number | null, vb = b[k] as number | null
    if (!isNum(va)) return 1
    if (!isNum(vb)) return -1
    return f.sort_desc ? vb - va : va - vb
  })
}

function activeCount(f: ScreenerFilters) {
  return FIELDS.filter(x => isNum(f[x.key] as number | null)).length + (f.sectors.length ? 1 : 0) + (f.above_sma200 ? 1 : 0)
}

export default function Screener() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ScreenerRow[] | null>(null)
  const [sectors, setSectors] = useState<string[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [filters, setFilters] = useState<ScreenerFilters>(EMPTY)
  const [preset, setPreset] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [query, setQuery] = useState("")
  const [parsing, setParsing] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [ranking, setRanking] = useState<{ summary: string; picks: RankedPick[] } | null>(null)
  const [rankBusy, setRankBusy] = useState(false)
  const presets = useAsync(() => api.presets(), [])

  const load = (force = false) => {
    setRows(null); setLoadErr(null); setProgress({ done: 0, total: 1, message: "Connecting" })
    streamEvents(`/screener/universe${force ? "?force=true" : ""}`, e => {
      if (e.type === "progress") setProgress({ done: Number(e.done ?? 0), total: Number(e.total ?? 1), message: String(e.message ?? "") })
      if (e.type === "complete") {
        const r = e.result as { rows: ScreenerRow[]; sectors: string[] }
        setRows(r.rows); setSectors(r.sectors); setProgress(null)
      }
      if (e.type === "error") { setLoadErr(e.message ?? "The scan failed."); setProgress(null) }
    }).catch(err => { setLoadErr(err.message); setProgress(null) })
  }
  useEffect(() => { load() }, [])

  const results = useMemo(() => rows ? applyFilters(rows, filters) : [], [rows, filters])
  const nActive = activeCount(filters)

  const setNum = (k: NumKey, v: string) => { setPreset(null); setFilters(f => ({ ...f, [k]: v === "" ? null : Number(v) })) }
  const askAI = async () => {
    if (query.trim().length < 3) return
    setParsing(true); setAiErr(null); setRanking(null)
    try {
      const f = await api.parseQuery(query)
      setFilters({ ...EMPTY, ...f, sectors: f.sectors ?? [] })
      setAiNote(f.explanation ? clean(f.explanation) : "Filters applied.")
      setPreset(null)
    } catch (e) { setAiErr((e as Error).message) } finally { setParsing(false) }
  }
  const rank = async () => {
    setRankBusy(true); setAiErr(null)
    try { setRanking(await api.rank(results.slice(0, 10).map(r => r.symbol), query || preset || "best overall")) }
    catch (e) { setAiErr((e as Error).message) } finally { setRankBusy(false) }
  }
  const sortBy = (k: keyof ScreenerRow) => setFilters(f => ({ ...f, sort_by: k, sort_desc: f.sort_by === k ? !f.sort_desc : true }))
  const toggleSel = (s: string) => setSelected(x => x.includes(s) ? x.filter(y => y !== s) : x.length >= 4 ? x : [...x, s])
  const reset = () => { setFilters(EMPTY); setPreset(null); setAiNote(null); setQuery(""); setRanking(null) }

  return (
    <div className="space-y-4">
      <PageHeader title="Screener"
        sub={rows ? `${rows.length} large and mid caps. Quality, value and momentum scores rank each stock against the others, from 0 to 100.` : "Loading the universe"}
        right={<button onClick={() => load(true)} className="btn-quiet" disabled={!!progress}>Refresh data</button>} />

      <form onSubmit={e => { e.preventDefault(); askAI() }} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="screen-q" className="sr-only">Describe a screen</label>
        <input id="screen-q" value={query} onChange={e => setQuery(e.target.value)} className="input h-10 flex-1"
          placeholder="Describe what you want, e.g. profitable IT companies with low debt near their 52-week high" />
        <button type="submit" disabled={parsing || query.trim().length < 3} className="btn-primary h-10">
          {parsing && <Spinner className="h-3.5 w-3.5" />}Screen
        </button>
      </form>
      {(aiNote || aiErr) && <p className={cx("text-[13px]", aiErr ? "text-down" : "text-fg-2")}>{aiErr ?? aiNote}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-fg-3">Presets</span>
        {(presets.data ?? []).map(p => (
          <button key={p.id} title={p.description} aria-pressed={preset === p.id}
            onClick={() => { setFilters({ ...EMPTY, ...p.filters, sectors: [] } as ScreenerFilters); setPreset(p.id); setAiNote(p.description); setRanking(null) }}
            className={cx("toggle", preset === p.id && "toggle-on")}>{p.label}</button>
        ))}
        <button onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters} className="toggle ml-auto">
          Filters{nActive ? <span className="num text-accent">{nActive}</span> : null}
          <CaretDown className={cx("h-3 w-3 transition-transform", showFilters && "rotate-180")} />
        </button>
        {nActive > 0 && <button onClick={reset} className="text-xs text-fg-3 hover:text-fg">Clear</button>}
      </div>

      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            <Panel className="space-y-5 p-5">
              <fieldset>
                <legend className="label mb-2">Sectors</legend>
                <div className="flex flex-wrap gap-1.5">
                  {sectors.map(s => (
                    <button key={s} aria-pressed={filters.sectors.includes(s)}
                      onClick={() => { setPreset(null); setFilters(f => ({ ...f, sectors: f.sectors.includes(s) ? f.sectors.filter(x => x !== s) : [...f.sectors, s] })) }}
                      className={cx("toggle", filters.sectors.includes(s) && "toggle-on")}>{s}</button>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 xl:grid-cols-6">
                {FIELDS.map(fd => (
                  <div key={fd.key}>
                    <label htmlFor={`f-${fd.key}`} className="label mb-1.5 block">{fd.label}</label>
                    <input id={`f-${fd.key}`} type="number" value={(filters[fd.key] as number | null | undefined) ?? ""} placeholder={fd.ph}
                      onChange={e => setNum(fd.key, e.target.value)} className="input num" />
                  </div>
                ))}
              </div>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-fg-2">
                <input type="checkbox" checked={!!filters.above_sma200} className="h-4 w-4 accent-[var(--accent)]"
                  onChange={e => setFilters(f => ({ ...f, above_sma200: e.target.checked ? true : null }))} />
                Only stocks above their 200-day average
              </label>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {loadErr && <ErrorNote message={loadErr} onRetry={() => load()} />}
      {progress && (
        <Panel className="p-5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-fg-2">{progress.message || "Scanning"}</span>
            <span className="num text-fg-3">{Math.round((progress.done / (progress.total || 1)) * 100)}%</span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div className="h-full origin-left bg-accent" style={{ width: "100%" }}
              animate={{ scaleX: Math.max(0.03, progress.done / (progress.total || 1)) }} transition={{ duration: 0.4 }} />
          </div>
          <p className="mt-2 text-xs text-fg-3">The first scan downloads a year of prices and fundamentals for about 90 stocks. It is cached for six hours.</p>
        </Panel>
      )}

      {ranking && (
        <Panel>
          <PanelHeader title="AI ranking of the top results" sub={clean(ranking.summary)}
            right={<button aria-label="Close ranking" onClick={() => setRanking(null)} className="text-fg-3 hover:text-fg"><X className="h-4 w-4" /></button>} />
          <ol className="border-t border-line">
            {ranking.picks.map(p => (
              <li key={p.symbol} className="row grid cursor-pointer grid-cols-[32px_88px_56px_1fr] gap-3 px-5 py-3 text-[13px] md:grid-cols-[32px_88px_56px_1fr_1fr]"
                onClick={() => navigate(`/stock/${encodeURIComponent(p.symbol)}`)}>
                <span className="num text-fg-3">{p.rank}</span>
                <span className="num text-fg">{ticker(p.symbol)}</span>
                <span className="num text-fg-2">{p.score.toFixed(1)}</span>
                <span className="text-fg-2">{clean(p.thesis)}</span>
                <span className="hidden text-fg-3 md:block">Risk: {clean(p.risk)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel>
        <PanelHeader title={<><span className="num">{results.length}</span> {results.length === 1 ? "match" : "matches"}</>}
          right={<button onClick={rank} disabled={rankBusy || results.length === 0} className="btn-secondary">
            {rankBusy && <Spinner className="h-3.5 w-3.5" />}Rank top {Math.min(10, results.length)} with AI
          </button>} />
        {!rows ? (
          <div className="space-y-2 px-5 pb-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : results.length === 0 ? (
          <Empty title="No stocks match these filters" action={<button onClick={reset} className="btn-secondary">Clear filters</button>}>
            Try loosening one condition.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-[13px] [&_td]:whitespace-nowrap">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-y border-line text-xs text-fg-3">
                  <th className="w-10 px-3 py-2"><span className="sr-only">Select</span></th>
                  <Th k="symbol" label="Company" f={filters} sort={sortBy} left />
                  <Th k="price" label="Price" f={filters} sort={sortBy} />
                  <Th k="change_1d_pct" label="1D" f={filters} sort={sortBy} />
                  <Th k="change_1m_pct" label="1M" f={filters} sort={sortBy} />
                  <Th k="change_1y_pct" label="1Y" f={filters} sort={sortBy} />
                  <th className="px-3 py-2 text-left font-normal">6 months</th>
                  <Th k="market_cap" label="Market cap" f={filters} sort={sortBy} />
                  <Th k="pe_ratio" label="P/E" f={filters} sort={sortBy} />
                  <Th k="return_on_equity" label="ROE" f={filters} sort={sortBy} />
                  <Th k="rsi_14" label="RSI" f={filters} sort={sortBy} />
                  <Th k="quality_score" label="Quality" f={filters} sort={sortBy} />
                  <Th k="value_score" label="Value" f={filters} sort={sortBy} />
                  <Th k="momentum_score" label="Momentum" f={filters} sort={sortBy} />
                  <Th k="overall_score" label="Overall" f={filters} sort={sortBy} />
                  <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 120).map(r => (
                  <tr key={r.symbol} className="row group">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Select ${ticker(r.symbol)} to compare`} checked={selected.includes(r.symbol)}
                        onChange={() => toggleSel(r.symbol)} className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]" />
                    </td>
                    <td className="cursor-pointer px-3 py-2" onClick={() => navigate(`/stock/${encodeURIComponent(r.symbol)}`)}>
                      <span className="num text-fg group-hover:underline">{ticker(r.symbol)}</span>
                      <span className="ml-2 inline-block max-w-[180px] truncate align-baseline text-xs text-fg-3">{r.sector}</span>
                    </td>
                    <td className="num px-3 py-2 text-right">{inr(r.price)}</td>
                    <td className="px-3 py-2 text-right"><Change value={r.change_1d_pct} /></td>
                    <td className="px-3 py-2 text-right"><Change value={r.change_1m_pct} decimals={1} /></td>
                    <td className="px-3 py-2 text-right"><Change value={r.change_1y_pct} decimals={1} /></td>
                    <td className="px-3 py-2"><Sparkline data={r.sparkline} width={76} height={20} /></td>
                    <td className="num px-3 py-2 text-right text-fg-2">{crore(r.market_cap)}</td>
                    <td className="num px-3 py-2 text-right">{num(r.pe_ratio, 1)}</td>
                    <td className="num px-3 py-2 text-right">{pct(r.return_on_equity, { sign: false, decimals: 1 })}</td>
                    <td className="num px-3 py-2 text-right">{num(r.rsi_14, 0)}</td>
                    <td className="num px-3 py-2 text-right text-fg-2">{r.quality_score}</td>
                    <td className="num px-3 py-2 text-right text-fg-2">{r.value_score}</td>
                    <td className="num px-3 py-2 text-right text-fg-2">{r.momentum_score}</td>
                    <td className={cx("num px-3 py-2 text-right", r.overall_score >= 70 ? "font-medium text-fg" : "text-fg-2")}>{r.overall_score}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => navigate(`/stock/${encodeURIComponent(r.symbol)}?debate=1`)}
                        className="text-xs text-fg-3 opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus:opacity-100">Analyse</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.18 }}
            className="fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-surface px-4 py-2.5 shadow-[var(--shadow)] lg:bottom-6">
            <span className="text-xs text-fg-3">Compare</span>
            {selected.map(s => (
              <span key={s} className="num flex items-center gap-1 text-[13px]">
                {ticker(s)}<button aria-label={`Remove ${ticker(s)}`} onClick={() => toggleSel(s)} className="text-fg-3 hover:text-fg"><X className="h-3 w-3" /></button>
              </span>
            ))}
            <button disabled={selected.length < 2} className="btn-primary h-8"
              onClick={() => navigate(`/compare?symbols=${selected.map(encodeURIComponent).join(",")}`)}>
              Compare {selected.length}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Th({ k, label, f, sort, left }: { k: keyof ScreenerRow; label: string; f: ScreenerFilters; sort: (k: keyof ScreenerRow) => void; left?: boolean }) {
  const active = f.sort_by === k
  return (
    <th className={cx("px-3 py-2 font-normal", left ? "text-left" : "text-right")} aria-sort={active ? (f.sort_desc ? "descending" : "ascending") : "none"}>
      <button onClick={() => sort(k)} className={cx("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}>
        {label}{active && (f.sort_desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  )
}
