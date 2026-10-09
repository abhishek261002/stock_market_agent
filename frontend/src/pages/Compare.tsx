// =============================================================================
// /compare — side-by-side comparison with an AI verdict
// =============================================================================

import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { X } from "@phosphor-icons/react"
import { MultiLineChart, SeriesLegend, type LineSeriesSpec } from "../components/charts"
import { SymbolPicker } from "../components/SymbolPicker"
import { Empty, ErrorNote, PageHeader, Panel, PanelHeader, Skeleton, Spinner } from "../components/ui"
import { api } from "../lib/api"
import { clean, crore, cx, inr, isNum, num, pct, ticker } from "../lib/format"
import type { CompareResult } from "../lib/types"

const STYLES: Pick<LineSeriesSpec, "tokenName" | "style">[] = [
  { tokenName: "accent", style: "solid" }, { tokenName: "fg", style: "solid" },
  { tokenName: "fg-2", style: "dashed" }, { tokenName: "fg-3", style: "dotted" },
]

type Row = { key: string; label: string; fmt: (v: number) => string; better: "high" | "low" | null }
const ROWS: Row[] = [
  { key: "current_price", label: "Price", fmt: v => inr(v), better: null },
  { key: "market_cap", label: "Market cap", fmt: v => crore(v), better: "high" },
  { key: "pe_ratio", label: "P/E", fmt: v => num(v, 1), better: "low" },
  { key: "forward_pe", label: "Forward P/E", fmt: v => num(v, 1), better: "low" },
  { key: "price_to_book", label: "P/B", fmt: v => num(v, 2), better: "low" },
  { key: "return_on_equity", label: "ROE", fmt: v => pct(v, { sign: false, decimals: 1 }), better: "high" },
  { key: "profit_margin", label: "Net margin", fmt: v => pct(v, { sign: false, decimals: 1 }), better: "high" },
  { key: "revenue_growth", label: "Revenue growth", fmt: v => pct(v, { decimals: 1 }), better: "high" },
  { key: "earnings_growth", label: "Earnings growth", fmt: v => pct(v, { decimals: 1 }), better: "high" },
  { key: "debt_to_equity", label: "Debt to equity", fmt: v => num(v, 2, "x"), better: "low" },
  { key: "dividend_yield", label: "Dividend yield", fmt: v => pct(v, { sign: false }), better: "high" },
  { key: "tech_change_1y_pct", label: "1Y return", fmt: v => pct(v, { decimals: 1 }), better: "high" },
  { key: "tech_volatility_ann", label: "Volatility", fmt: v => pct(v, { sign: false, decimals: 1 }), better: "low" },
  { key: "tech_max_drawdown_1y", label: "Max drawdown", fmt: v => pct(v, { decimals: 1 }), better: "high" },
  { key: "target_upside_pct", label: "Analyst upside", fmt: v => pct(v, { decimals: 1 }), better: "high" },
]

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const symbols = useMemo(() => (params.get("symbols") ?? "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 4), [params])
  const [data, setData] = useState<CompareResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setSymbols = (xs: string[]) => setParams(xs.length ? { symbols: xs.join(",") } : {})
  useEffect(() => { setData(null) }, [symbols.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setErr(null)
    try { setData(await api.compare(symbols)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const series: LineSeriesSpec[] = useMemo(() => data ? data.symbols.map((s, i) => ({
    name: ticker(s), ...STYLES[i], data: data.performance[s] ?? [],
  })) : [], [data])

  return (
    <div className="space-y-4">
      <PageHeader title="Compare" sub="Put two to four stocks side by side and get a reasoned pick." />

      <Panel className="flex flex-wrap items-end gap-3 p-4">
        {symbols.map(s => (
          <span key={s} className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-3 text-[13px]">
            <span className="num">{ticker(s)}</span>
            <button aria-label={`Remove ${ticker(s)}`} onClick={() => setSymbols(symbols.filter(x => x !== s))} className="text-fg-3 hover:text-fg">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {symbols.length < 4 && <SymbolPicker exclude={symbols} onPick={s => setSymbols([...symbols, s])} />}
        <button onClick={run} disabled={symbols.length < 2 || busy} className="btn-primary ml-auto">
          {busy && <Spinner className="h-3.5 w-3.5" />}{busy ? "Comparing" : "Compare"}
        </button>
      </Panel>

      {err && <ErrorNote message={err} onRetry={run} />}

      {!data && !busy && (
        <Panel>
          <Empty title={symbols.length < 2 ? "Add at least two stocks" : "Ready to compare"}>
            You can also select rows in the <Link to="/screener" className="text-fg underline underline-offset-4">screener</Link>, or use a stock's Peers tab.
          </Empty>
        </Panel>
      )}
      {busy && !data && <Panel className="space-y-3 p-5"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-64" /></Panel>}

      {data && (
        <>
          <Panel>
            <div className="grid gap-6 px-5 py-6 md:grid-cols-[200px_1fr]">
              <div>
                <p className="label">Preferred pick</p>
                <p className="num mt-1 text-4xl font-semibold tracking-tight text-fg">{ticker(data.verdict.winner)}</p>
              </div>
              <div>
                <h2 className="max-w-[60ch] text-lg font-medium leading-snug">{clean(data.verdict.headline)}</h2>
                <p className="mt-2 max-w-[75ch] text-[14px] leading-relaxed text-fg-2">{clean(data.verdict.reasoning)}</p>
              </div>
            </div>
            <div className={cx("grid gap-px border-t border-line bg-line", data.verdict.entries.length > 2 ? "lg:grid-cols-4 md:grid-cols-2" : "md:grid-cols-2")}>
              {[...data.verdict.entries].sort((a, b) => b.score - a.score).map(e => (
                <article key={e.symbol} className="bg-surface px-5 py-4">
                  <header className="flex items-baseline justify-between">
                    <h3 className="num text-[14px]">{ticker(e.symbol)}</h3>
                    <span className="num text-xs text-fg-3"><span className="text-fg">{e.score.toFixed(1)}</span> / 10</span>
                  </header>
                  <p className="mt-0.5 text-xs text-fg-3">Suits: {clean(e.best_for)}</p>
                  <ul className="mt-3 space-y-1 text-[13px]">
                    {e.strengths.map((s, j) => <li key={`s${j}`} className="text-fg-2"><span className="text-up">+</span> {clean(s)}</li>)}
                    {e.weaknesses.map((s, j) => <li key={`w${j}`} className="text-fg-2"><span className="text-down">-</span> {clean(s)}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="One-year performance" sub="Rebased to 100" right={<SeriesLegend series={series} />} />
            <div className="px-2 pb-3"><MultiLineChart series={series} height={300} /></div>
          </Panel>

          <Panel>
            <PanelHeader title="Figures" sub="The better value in each row is highlighted" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-[13px] [&_td]:whitespace-nowrap">
                <thead>
                  <tr className="border-y border-line text-xs text-fg-3">
                    <th className="px-5 py-2 text-left font-normal">Metric</th>
                    {data.stocks.map(s => <th key={s.symbol} className="num px-5 py-2 text-right font-normal text-fg">{ticker(s.symbol)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(r => {
                    const vals = data.stocks.map(s => (s as Record<string, unknown>)[r.key] as number | null)
                    const nums = vals.filter(isNum)
                    const best = r.better && nums.length > 1 ? (r.better === "high" ? Math.max(...nums) : Math.min(...nums)) : null
                    return (
                      <tr key={r.key} className="row">
                        <td className="px-5 py-2 text-fg-3">{r.label}</td>
                        {vals.map((v, i) => (
                          <td key={i} className={cx("num px-5 py-2 text-right", best !== null && v === best ? "font-medium text-fg" : "text-fg-2")}>
                            {best !== null && v === best && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
                            {isNum(v) ? r.fmt(v) : "-"}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
