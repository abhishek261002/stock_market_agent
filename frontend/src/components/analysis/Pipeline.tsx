// =============================================================================
// Pipeline progress: a quiet stepper + activity log for the live analysis
// =============================================================================

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef } from "react"
import { Check, Circle, CircleNotch, Hourglass, X } from "@phosphor-icons/react"
import { useTick } from "../../hooks/useAsync"
import type { LogLine, StageState } from "../../hooks/useAnalysisStream"
import { cx } from "../../lib/format"
import type { StageId, StageStatus } from "../../lib/types"

interface Step { id: string; label: string; stages: StageId[] }

const STEPS: Step[] = [
  { id: "data", label: "Market data", stages: ["fetch_data"] },
  { id: "fund", label: "Fundamentals", stages: ["fundamentals"] },
  { id: "tech", label: "Technicals", stages: ["technical"] },
  { id: "news", label: "News", stages: ["news"] },
  { id: "debate", label: "Debate", stages: ["bull", "bear"] },
  { id: "judge", label: "Verdict", stages: ["judge"] },
  { id: "risk", label: "Trade plan", stages: ["risk"] },
]

function combine(states: StageState[]): StageState {
  if (states.some(s => s.status === "error")) return { status: "error" }
  if (states.some(s => s.status === "running")) {
    const started = Math.min(...states.filter(s => s.startedAt).map(s => s.startedAt as number))
    return { status: "running", startedAt: Number.isFinite(started) ? started : undefined, throttle: states.find(s => s.throttle)?.throttle }
  }
  if (states.every(s => s.status === "done")) return { status: "done", elapsed: Math.max(...states.map(s => s.elapsed ?? 0)) || undefined }
  if (states.some(s => s.status === "done")) return { status: "running" }
  return { status: "idle" }
}

function StatusIcon({ status }: { status: StageStatus }) {
  if (status === "done") return <Check className="h-3.5 w-3.5 text-up" weight="bold" />
  if (status === "running") return <CircleNotch className="h-3.5 w-3.5 animate-spin text-accent" weight="bold" />
  if (status === "error") return <X className="h-3.5 w-3.5 text-down" weight="bold" />
  return <Circle className="h-3.5 w-3.5 text-fg-3" />
}

export function PipelineSteps({ stages, currentRound, maxRounds, running }: {
  stages: Record<StageId, StageState>; currentRound: number; maxRounds: number; running: boolean
}) {
  useTick(1000, running)
  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4 xl:grid-cols-7">
      {STEPS.map(step => {
        const s = combine(step.stages.map(id => stages[id]))
        const secs = s.status === "running" && s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : s.elapsed
        return (
          <li key={step.id} className={cx("bg-surface px-3 py-2.5", s.status === "running" && "bg-surface-2")}>
            <div className="flex items-center gap-2">
              <StatusIcon status={s.status} />
              <span className={cx("text-[13px]", s.status === "idle" ? "text-fg-3" : "text-fg")}>{step.label}</span>
            </div>
            <p className="num mt-1 h-4 pl-[22px] text-[11px] text-fg-3">
              {s.throttle && s.status === "running"
                ? <span className="inline-flex items-center gap-1"><Hourglass className="h-3 w-3" />rate limit</span>
                : step.id === "debate" && s.status !== "idle"
                  ? `round ${Math.max(1, currentRound)} of ${maxRounds}${secs !== undefined ? `, ${secs}s` : ""}`
                  : secs !== undefined && s.status !== "idle" ? `${secs}s` : ""}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

export function ActivityLog({ log }: { log: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [log.length])
  const start = log[0]?.t ?? 0
  return (
    <div ref={ref} className="num max-h-40 overflow-y-auto text-[11.5px] leading-6" aria-live="polite">
      <AnimatePresence initial={false}>
        {log.map((l, i) => (
          <motion.div key={`${l.t}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <span className="w-14 shrink-0 text-right text-fg-3">{((l.t - start) / 1000).toFixed(1)}s</span>
            <span className={cx(l.tone === "err" ? "text-down" : l.tone === "warn" ? "text-accent" : l.tone === "ok" ? "text-fg" : "text-fg-2")}>
              {l.text}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
