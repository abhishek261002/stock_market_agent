// =============================================================================
// Verdict, trade plan, follow-up chat, run controls
// =============================================================================

import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { PaperPlaneRight } from "@phosphor-icons/react"
import { streamEvents } from "../../lib/api"
import { actionColor, actionWord, clean, cx, inr, pct, timeAgo } from "../../lib/format"
import type { AnalysisSummary, RiskPlan, Verdict } from "../../lib/types"
import { Meter, PanelHeader, Segmented, Spinner } from "../ui"

export function VerdictBlock({ verdict, previous }: { verdict: Verdict; previous?: AnalysisSummary | null }) {
  const c = actionColor[verdict.verdict]
  const changed = previous?.verdict && previous.verdict !== verdict.verdict
  return (
    <div>
      <div className="grid gap-8 px-5 py-6 md:grid-cols-[220px_1fr]">
        <div>
          <p className="label">Verdict</p>
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            className={cx("mt-1 text-5xl font-semibold tracking-tight", c.text)}>
            {actionWord[verdict.verdict]}
          </motion.p>
          <p className="num mt-3 text-[13px] text-fg-2"><span className="text-fg">{verdict.confidence.toFixed(1)}</span> / 10 confidence</p>
          <Meter value={verdict.confidence} tone={verdict.verdict === "BUY" ? "up" : verdict.verdict === "SELL" ? "down" : "fg"} className="mt-2 w-40" />
          <dl className="mt-5 space-y-2 text-xs">
            <div><dt className="text-fg-3">Horizon</dt><dd className="text-fg-2">{verdict.time_horizon}</dd></div>
            <div><dt className="text-fg-3">Stronger argument</dt><dd className="text-fg-2">{verdict.winner === "draw" ? "Even" : verdict.winner === "bull" ? "Bull" : "Bear"}</dd></div>
            {previous?.verdict && (
              <div>
                <dt className="text-fg-3">Previous call</dt>
                <dd className={changed ? "text-accent" : "text-fg-2"}>
                  {actionWord[previous.verdict]} {timeAgo(previous.created_at)}{changed ? ", changed" : ""}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <div className="min-w-0">
          <h3 className="max-w-[60ch] text-lg font-medium leading-snug text-fg">{clean(verdict.headline)}</h3>
          <p className="mt-3 max-w-[70ch] text-[14px] leading-relaxed text-fg-2">{clean(verdict.reasoning)}</p>
          {verdict.decisive_factors.length > 0 && (
            <>
              <p className="label mt-5">What decided it</p>
              <ul className="mt-2 space-y-1.5">
                {verdict.decisive_factors.map((f, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-fg">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />{clean(f)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <div className="grid gap-px border-t border-line bg-line md:grid-cols-2">
        <Note title="On the bull case" body={verdict.bull_assessment} />
        <Note title="On the bear case" body={verdict.bear_assessment} />
        <ListNote title="Risks to watch" items={verdict.key_risks} />
        <ListNote title="Possible catalysts" items={verdict.catalysts} />
      </div>
      <div className="border-t border-line px-5 py-4">
        <p className="label">Suggested action</p>
        <p className="mt-1 max-w-[80ch] text-[14px] text-fg">{clean(verdict.suggested_action)}</p>
      </div>
    </div>
  )
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="label">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{clean(body)}</p>
    </div>
  )
}

function ListNote({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="label">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {items.length === 0 && <li className="text-[13px] text-fg-3">None noted</li>}
        {items.map((r, i) => <li key={i} className="text-[13px] leading-snug text-fg-2">{clean(r)}</li>)}
      </ul>
    </div>
  )
}

// ─── Trade plan ───────────────────────────────────────────────────────────────
export function TradePlan({ plan }: { plan: RiskPlan }) {
  const levels = ([
    { label: "Target 2", value: plan.target_2, tone: "up" },
    { label: "Target 1", value: plan.target_1, tone: "up" },
    { label: "Resistance", value: plan.nearest_resistance, tone: "muted" },
    { label: "Entry", value: plan.entry, tone: "accent" },
    { label: "Support", value: plan.nearest_support, tone: "muted" },
    { label: "Stop loss", value: plan.stop_loss, tone: "down" },
  ] as const).filter(l => l.value !== null && l.value !== undefined) as { label: string; value: number; tone: string }[]

  const vals = levels.map(l => l.value)
  const max = Math.max(...vals), min = Math.min(...vals)
  const raw = levels.map(l => ({ l, p: 6 + ((max - l.value) / (max - min || 1)) * 88 })).sort((a, b) => a.p - b.p)
  const GAP = 11
  for (let i = 1; i < raw.length; i++) raw[i].p = Math.max(raw[i].p, raw[i - 1].p + GAP)
  const over = raw.length ? raw[raw.length - 1].p - 94 : 0
  if (over > 0) for (let i = raw.length - 1; i >= 0; i--) {
    raw[i].p -= over
    if (i > 0 && raw[i - 1].p > raw[i].p - GAP) raw[i - 1].p = raw[i].p - GAP
  }
  const color = (t: string) => t === "up" ? "text-up" : t === "down" ? "text-down" : t === "accent" ? "text-accent" : "text-fg-3"
  const dot = (t: string) => t === "up" ? "bg-up" : t === "down" ? "bg-down" : t === "accent" ? "bg-accent" : "bg-fg-3"

  return (
    <div>
      <PanelHeader title="Trade plan" sub="Levels from the stock's average true range, sized to risk 1% of capital" />
      <div className="grid gap-8 px-5 pb-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative mt-2 h-60" aria-label="Price levels">
          <div className="absolute bottom-[4%] left-[86px] top-[4%] w-px bg-line-strong" />
          {raw.map(({ l, p }) => (
            <div key={l.label} className="absolute left-0 right-0 flex -translate-y-1/2 items-center" style={{ top: `${p}%` }}>
              <span className={cx("w-[78px] text-right text-xs", l.label === "Entry" ? "text-fg" : "text-fg-3")}>{l.label}</span>
              <span className={cx("ml-[5px] h-[7px] w-[7px] rounded-full", dot(l.tone))} />
              <span className={cx("num ml-3 text-[13px]", color(l.tone))}>{inr(l.value)}</span>
            </div>
          ))}
        </div>
        <div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div><dt className="label">Risk to reward</dt><dd className="num mt-1 text-[15px]">{plan.risk_reward ? `1 : ${plan.risk_reward.toFixed(2)}` : "-"}</dd></div>
            <div><dt className="label">Position size</dt><dd className="num mt-1 text-[15px]">{plan.position_size_pct.toFixed(1)}%</dd></div>
            <div><dt className="label">{plan.action === "SELL" ? "Stop above entry" : "Stop distance"}</dt><dd className="num mt-1 text-[15px]">{pct(plan.stop_distance_pct, { sign: false })}</dd></div>
            <div><dt className="label">Volatility</dt><dd className="mt-1 text-[15px] capitalize">{plan.volatility_regime}</dd></div>
          </dl>
          {plan.notes.length > 0 && (
            <ul className="mt-5 space-y-1.5 border-t border-line pt-4">
              {plan.notes.map((n, i) => <li key={i} className="text-[13px] leading-snug text-fg-2">{clean(n)}</li>)}
            </ul>
          )}
          {plan.invalidation && (
            <p className="mt-3 text-[13px] text-fg-2"><span className="text-down">Invalidated if</span> {clean(plan.invalidation).replace(/^./, s => s.toLowerCase())}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Follow-up chat ───────────────────────────────────────────────────────────
interface Msg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = ["Why not the opposite call?", "What would change the verdict?", "Which risk matters most now?"]

export function FollowUpChat({ analysisId, symbol }: { analysisId: string; symbol: string }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => { setMessages([]); setErr(null) }, [analysisId])
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [messages])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    const history: Msg[] = [...messages, { role: "user", content: q }]
    setMessages([...history, { role: "assistant", content: "" }])
    setInput(""); setBusy(true); setErr(null)
    try {
      await streamEvents("/chat", e => {
        if (e.type === "token" && e.text) {
          setMessages(m => {
            const copy = [...m]
            copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + e.text }
            return copy
          })
        } else if (e.type === "error") setErr(e.message ?? "The answer could not be generated.")
      }, { body: { analysis_id: analysisId, messages: history } })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Ask about this verdict" sub={`Answers use only the ${symbol} analysis above`} />
      <div ref={scroller} className="max-h-80 min-h-24 flex-1 space-y-4 overflow-y-auto px-5 pb-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-1">
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} className="text-left text-[13px] text-fg-2 underline decoration-line-strong underline-offset-4 hover:text-fg hover:decoration-fg-3">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx("text-[13px] leading-relaxed", m.role === "user" ? "ml-10 rounded-md bg-surface-2 px-3 py-2 text-fg" : "whitespace-pre-wrap text-fg-2")}>
            {m.content ? clean(m.content) : busy && i === messages.length - 1 ? <Spinner className="h-3.5 w-3.5 text-fg-3" /> : ""}
          </div>
        ))}
        {err && <p className="text-xs text-down">{err}</p>}
      </div>
      <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex gap-2 border-t border-line p-3">
        <label htmlFor="followup" className="sr-only">Question</label>
        <input id="followup" value={input} onChange={e => setInput(e.target.value)} placeholder="What if the next results disappoint?"
          className="input" disabled={busy} maxLength={600} />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="btn-secondary w-9 px-0">
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <PaperPlaneRight className="h-4 w-4" />}
        </button>
      </form>
    </div>
  )
}

export function RunControls({ onRun, rounds, setRounds, maxRounds, disabled, label = "Run analysis" }: {
  onRun: () => void; rounds: number; setRounds: (n: number) => void; maxRounds: number; disabled?: boolean; label?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-fg-3">Debate rounds</span>
      <Segmented label="Debate rounds" value={rounds} onChange={setRounds}
        options={Array.from({ length: maxRounds }, (_, i) => ({ id: i + 1, label: String(i + 1) }))} />
      <button onClick={onRun} disabled={disabled} className="btn-primary">{label}</button>
    </div>
  )
}
