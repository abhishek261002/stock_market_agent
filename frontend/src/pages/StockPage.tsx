// =============================================================================
// /stock/:symbol — chart, fundamentals and the AI analysis
// =============================================================================

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowSquareOut, BellRinging, BookmarkSimple, CaretDown, GitDiff } from "@phosphor-icons/react"
import { ActivityLog, PipelineSteps } from "../components/analysis/Pipeline"
import { AnalystReports, DebateTranscript, NewsList } from "../components/analysis/Debate"
import { FollowUpChat, RunControls, TradePlan, VerdictBlock } from "../components/analysis/Verdict"
import { PriceChart } from "../components/charts"
import { FinancialBars, KeyStats, PeersTable, RangeBar, Returns, TechSnapshot } from "../components/stock"
import { AnimatedNumber, Change, ErrorNote, Panel, PanelHeader, Skeleton, Spinner, Tabs, VerdictBadge } from "../components/ui"
import { useAnalysisStream, type AnalysisStream } from "../hooks/useAnalysisStream"
import { useAsync, useTick } from "../hooks/useAsync"
import { api } from "../lib/api"
import { useAppData } from "../lib/appData"
import { cx, inr, ticker, timeAgo } from "../lib/format"
import type { Headline } from "../lib/types"

type Tab = "analysis" | "financials" | "peers" | "news" | "company"

export default function StockPage() {
  const { symbol: raw = "" } = useParams()
  const symbol = decodeURIComponent(raw).toUpperCase()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { config, refreshConfig } = useAppData()
  const detail = useAsync(() => api.stock(symbol), [symbol])
  const stream = useAnalysisStream()
  const [tab, setTab] = useState<Tab>("analysis")
  const [rounds, setRounds] = useState(2)
  const [watching, setWatching] = useState(false)
  const autoRan = useRef<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  const d = detail.data?.data
  useEffect(() => { if (detail.data) setWatching(detail.data.in_watchlist) }, [detail.data])
  useEffect(() => { if (config) setRounds(r => Math.min(r, config.max_rounds)) }, [config])
  useEffect(() => { stream.reset(); setTab("analysis") }, [symbol]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load ?analysis=id, otherwise the latest saved analysis for this stock
  useEffect(() => {
    const id = params.get("analysis")
    if (id) {
      api.analysis(id).then(stream.load).catch(() => {})
    } else if (detail.data?.history?.[0] && !stream.running && !stream.result && params.get("debate") !== "1") {
      api.analysis(detail.data.history[0].id).then(r => { if (r.symbol === symbol) stream.load(r) }).catch(() => {})
    }
  }, [params, detail.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    setTab("analysis")
    setParams({}, { replace: true })
    stream.run(symbol, rounds).then(() => { detail.reload(true); refreshConfig() })
    setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100)
  }

  useEffect(() => {
    if (params.get("debate") === "1" && detail.data && autoRan.current !== symbol) {
      autoRan.current = symbol
      run()
    }
  }, [params, detail.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWatch = async () => {
    setWatching(w => !w)
    try {
      if (watching) await api.unwatch(symbol)
      else await api.watch(symbol)
    } catch { setWatching(w => !w) }
  }

  const hasAnalysis = stream.running || stream.result || stream.log.length > 0 || stream.error
  const last = detail.data?.history?.[0]

  if (detail.error) {
    return (
      <div className="mx-auto max-w-xl pt-16">
        <ErrorNote message={detail.error} onRetry={() => detail.reload()} />
        <p className="mt-4 text-[13px] text-fg-2">
          NSE tickers look like <span className="num text-fg">INFY.NS</span> and BSE tickers like <span className="num text-fg">500209.BO</span>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="text-[13px] text-fg-3">
            <span className="num text-fg-2">{ticker(symbol)}</span>
            {d && <>, {d.exchange}, {d.sector}</>}
          </p>
          {d ? (
            <>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{d.name}</h1>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <AnimatedNumber value={d.current_price} format={v => inr(v)} className="text-3xl font-medium tracking-tight" />
                <Change value={d.change_1d_pct} className="text-[15px]" />
                <span className="text-xs text-fg-3">today</span>
                {last && (
                  <span className="ml-2 flex items-center gap-1.5 text-xs text-fg-3">
                    Last AI verdict <VerdictBadge verdict={last.verdict} /> {timeAgo(last.created_at)}
                  </span>
                )}
              </div>
            </>
          ) : <div className="mt-2 space-y-2"><Skeleton className="h-7 w-72" /><Skeleton className="h-9 w-48" /></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={toggleWatch} aria-pressed={watching} className={cx("btn-secondary", watching && "border-accent")}>
            <BookmarkSimple className="h-4 w-4" weight={watching ? "fill" : "regular"} />{watching ? "Watching" : "Watch"}
          </button>
          <PriceAlertButton symbol={symbol} price={d?.current_price} />
          <Link to={`/compare?symbols=${encodeURIComponent(symbol)}`} className="btn-secondary"><GitDiff className="h-4 w-4" />Compare</Link>
        </div>
      </div>

      {/* Chart + side facts */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title="Price" sub="Daily candles with moving averages, volume and RSI" />
          {detail.data ? <PriceChart candles={detail.data.chart.candles} /> : <Skeleton className="mx-5 mb-5 h-[420px]" />}
        </Panel>
        <Panel className="divide-y divide-line">
          <div className="space-y-5 p-5">
            {d ? (
              <>
                <Returns d={d} />
                <RangeBar label="52-week range" low={d.week_52_low} high={d.week_52_high} value={d.current_price} />
                {d.target_low && d.target_high && (
                  <RangeBar label={`Analyst targets, ${d.analyst_count ?? "?"} analysts`}
                    low={Math.min(d.target_low, d.current_price)} high={Math.max(d.target_high, d.current_price)}
                    value={d.current_price} marker={{ value: d.target_price, label: "Mean" }} />
                )}
              </>
            ) : <Skeleton className="h-36" />}
          </div>
          <div className="px-5 pb-3 pt-4">
            <p className="label mb-1">Technicals</p>
            {d ? <TechSnapshot d={d} /> : <Skeleton className="h-48" />}
          </div>
        </Panel>
      </div>

      <Panel className="p-5">
        <h2 className="mb-4 text-[14px] font-medium">Key figures</h2>
        {d ? <KeyStats d={d} /> : <Skeleton className="h-28" />}
      </Panel>

      {/* Tabs */}
      <div ref={tabsRef} className="scroll-mt-28">
        <Tabs id="stock" value={tab} onChange={setTab} tabs={[
          { id: "analysis", label: <>AI analysis{stream.running && <Spinner className="h-3 w-3 text-accent" />}</> },
          { id: "financials", label: "Financials" },
          { id: "peers", label: "Peers" },
          { id: "news", label: "News" },
          { id: "company", label: "Company" },
        ]} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          className="space-y-4">
          {tab === "analysis" && (
            !hasAnalysis ? (
              <Panel className="p-6">
                <h2 className="text-lg font-medium">No analysis for {ticker(symbol)} yet</h2>
                <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-fg-2">
                  Three analysts review the fundamentals, price action and recent news. A bull and a bear then argue
                  the case over one to four rounds, and a judge gives a verdict with a sized trade plan.
                </p>
                <div className="mt-5"><RunControls onRun={run} rounds={rounds} setRounds={setRounds} maxRounds={config?.max_rounds ?? 4} disabled={!d} /></div>
                <p className="mt-3 text-xs text-fg-3">
                  {config?.models?.demo ? "Demo mode is on, so responses are simulated."
                    : `Usually takes one to three minutes${config?.llm_rpm && config.llm_rpm <= 10 ? `; the free Gemini tier allows ${config.llm_rpm} requests a minute, so steps queue` : ""}.`}
                </p>
              </Panel>
            ) : (
              <AnalysisView stream={stream} run={run} rounds={rounds} setRounds={setRounds}
                maxRounds={config?.max_rounds ?? 4} symbol={symbol} />
            )
          )}
          {tab === "financials" && (
            <Panel>
              <PanelHeader title="Quarterly results" sub="Last reported quarters" />
              {detail.data ? <FinancialBars rows={detail.data.financials} currency={d?.financial_currency ?? "INR"} /> : <Skeleton className="m-5 h-56" />}
            </Panel>
          )}
          {tab === "peers" && (
            <Panel>
              <PanelHeader title="Sector peers" sub={d?.sector}
                right={detail.data?.peers.length ? (
                  <button className="btn-quiet"
                    onClick={() => navigate(`/compare?symbols=${[symbol, ...detail.data!.peers.slice(0, 2).map(p => p.symbol)].map(encodeURIComponent).join(",")}`)}>
                    Compare with top two
                  </button>) : undefined} />
              {detail.data ? <PeersTable peers={detail.data.peers} self={d} /> : <Skeleton className="m-5 h-56" />}
            </Panel>
          )}
          {tab === "news" && <NewsTab symbol={symbol} analysed={stream.reports.news?.headlines ?? []} />}
          {tab === "company" && d && (
            <Panel className="p-6">
              <h2 className="text-[15px] font-medium">{d.name}</h2>
              <p className="mt-1 text-[13px] text-fg-3">{d.industry}, {d.sector}</p>
              <p className="mt-4 max-w-[70ch] text-[14px] leading-relaxed text-fg-2">{d.summary || "No company description available."}</p>
              {d.website && (
                <a href={d.website} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg-3">
                  {d.website.replace(/^https?:\/\//, "")}<ArrowSquareOut className="h-3.5 w-3.5" />
                </a>
              )}
            </Panel>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function AnalysisView({ stream: s, run, rounds, setRounds, maxRounds, symbol }: {
  stream: AnalysisStream; run: () => void; rounds: number; setRounds: (n: number) => void; maxRounds: number; symbol: string
}) {
  useTick(1000, s.running)
  const [showLog, setShowLog] = useState(false)
  const elapsed = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : null
  const done = !!s.result && !s.running

  const evidence = (
    <>
      {(s.running || Object.keys(s.reports).length > 0) && (
        <Panel>
          <PanelHeader title="Analyst reports" />
          <AnalystReports reports={s.reports} running={s.running} />
        </Panel>
      )}
      {(s.debate.length > 0 || s.stages.bull.status === "running") && (
        <Panel>
          <PanelHeader title="Debate" sub="Each side argues, then rebuts the other. Confidence is out of 10." />
          <DebateTranscript debate={s.debate} maxRounds={s.maxRounds} running={s.running} currentRound={s.currentRound} />
        </Panel>
      )}
    </>
  )

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-medium">
              {s.running ? "Analysis in progress" : done ? "Analysis complete" : s.error ? "Analysis stopped" : "Analysis"}
            </h2>
            <p className="mt-0.5 text-xs text-fg-3">
              {s.running && elapsed !== null && `${elapsed}s elapsed`}
              {done && s.result && `${new Date(s.result.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}, ${s.result.rounds} debate round${s.result.rounds > 1 ? "s" : ""}, ${s.result.duration_sec}s`}
            </p>
          </div>
          {s.running
            ? <button onClick={s.cancel} className="btn-quiet">Stop following</button>
            : <RunControls onRun={run} rounds={rounds} setRounds={setRounds} maxRounds={maxRounds} label="Run again" />}
        </div>
        {(s.running || !done) && (
          <div className="px-5 pb-4"><PipelineSteps stages={s.stages} currentRound={s.currentRound} maxRounds={s.maxRounds} running={s.running} /></div>
        )}
        {s.log.length > 0 && (
          <div className="border-t border-line px-5 py-3">
            {s.running || showLog ? <ActivityLog log={s.log} /> : null}
            {!s.running && (
              <button onClick={() => setShowLog(v => !v)} className="mt-1 flex items-center gap-1 text-xs text-fg-3 hover:text-fg-2">
                <CaretDown className={cx("h-3 w-3 transition-transform", showLog && "rotate-180")} />{showLog ? "Hide activity" : "Show activity"}
              </button>
            )}
          </div>
        )}
      </Panel>

      {s.error && <ErrorNote message={s.error} onRetry={run} />}

      {s.verdict ? (
        <>
          <Panel><VerdictBlock verdict={s.verdict} previous={s.result?.previous} /></Panel>
          {(s.risk || s.result) && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              {s.risk && <Panel><TradePlan plan={s.risk} /></Panel>}
              {s.result && <Panel><FollowUpChat analysisId={s.result.id} symbol={ticker(symbol)} /></Panel>}
            </div>
          )}
          {evidence}
        </>
      ) : evidence}

      {s.result?.warnings?.length ? (
        <p className="text-xs text-fg-3">Some steps ran with reduced input: {s.result.warnings.join("; ")}</p>
      ) : null}
      {s.result && <p className="max-w-[90ch] text-[11px] leading-relaxed text-fg-3">{s.result.disclaimer}</p>}
    </>
  )
}

function NewsTab({ symbol, analysed }: { symbol: string; analysed: Headline[] }) {
  const live = useAsync(() => fetch(`/api/stock/${encodeURIComponent(symbol)}/news`).then(r => r.json() as Promise<Headline[]>),
    [symbol], { enabled: analysed.length === 0 })
  const items = analysed.length ? analysed : live.data ?? []
  return (
    <Panel>
      <PanelHeader title="News" sub={analysed.length ? "Sentiment from the news analyst" : "Latest headlines. Run an analysis to score sentiment."} />
      {live.loading && !analysed.length ? <div className="space-y-3 px-5 pb-5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}</div>
        : items.length ? <NewsList headlines={items} /> : <p className="px-5 pb-6 text-[13px] text-fg-2">No recent headlines found.</p>}
    </Panel>
  )
}

function PriceAlertButton({ symbol, price }: { symbol: string; price?: number }) {
  const [open, setOpen] = useState(false)
  const [dir, setDir] = useState<"above" | "below">("above")
  const [value, setValue] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (price) setValue((price * 1.05).toFixed(2)) }, [price])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  const save = async () => {
    const v = parseFloat(value)
    if (!v || v <= 0) { setMsg({ ok: false, text: "Enter a price above zero." }); return }
    try {
      await api.addPriceAlert(symbol, dir, v)
      setMsg({ ok: true, text: `You'll be alerted when it trades ${dir} ${inr(v)}.` })
      setTimeout(() => { setOpen(false); setMsg(null) }, 1400)
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} className="btn-secondary"><BellRinging className="h-4 w-4" />Alert</button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}
            className="absolute right-0 top-11 z-30 w-72 rounded-lg border border-line-strong bg-surface p-4 shadow-[var(--shadow)]">
            <p className="text-[13px] font-medium">Price alert for {ticker(symbol)}</p>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-line p-0.5">
              {(["above", "below"] as const).map(x => (
                <button key={x} onClick={() => setDir(x)} className={cx("rounded-[4px] py-1 text-xs", dir === x ? "bg-surface-3 text-fg" : "text-fg-3")}>
                  Crosses {x}
                </button>
              ))}
            </div>
            <label htmlFor="alert-price" className="label mb-1.5 mt-3 block">Price (₹)</label>
            <input id="alert-price" className="input num" value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" />
            <button onClick={save} className="btn-primary mt-3 w-full">Create alert</button>
            {msg && <p className={cx("mt-2 text-xs", msg.ok ? "text-fg-2" : "text-down")}>{msg.text}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
