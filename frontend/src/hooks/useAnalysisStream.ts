// =============================================================================
// useAnalysisStream — drives the live multi-agent debate UI from SSE events
// =============================================================================

import { useCallback, useRef, useState } from "react"
import { streamEvents } from "../lib/api"
import type {
  AnalysisResult, AnalystReport, DebateArgument, DebateEntry, PipelineEvent, RiskPlan, StageId, StageStatus, Verdict,
} from "../lib/types"

export interface StageState {
  status: StageStatus
  startedAt?: number
  elapsed?: number
  round?: number
  throttle?: number      // seconds the stage is waiting for an LLM slot
  message?: string
}

export interface LogLine { t: number; text: string; tone: "info" | "ok" | "warn" | "err" }

const STAGES: StageId[] = ["fetch_data", "fundamentals", "technical", "news", "bull", "bear", "judge", "risk"]
const LABEL: Record<StageId, string> = {
  fetch_data: "Market data", fundamentals: "Fundamentals analyst", technical: "Technical analyst",
  news: "News analyst", bull: "Bull", bear: "Bear", judge: "Judge", risk: "Trade plan",
}

const idle = (): Record<StageId, StageState> =>
  Object.fromEntries(STAGES.map(s => [s, { status: "idle" as StageStatus }])) as Record<StageId, StageState>

export function useAnalysisStream() {
  const [stages, setStages] = useState<Record<StageId, StageState>>(idle)
  const [reports, setReports] = useState<AnalysisResult["analyst_reports"]>({})
  const [debate, setDebate] = useState<DebateEntry[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [risk, setRisk] = useState<RiskPlan | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [maxRounds, setMaxRounds] = useState(2)
  const [currentRound, setCurrentRound] = useState(0)
  const [log, setLog] = useState<LogLine[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const push = (text: string, tone: LogLine["tone"] = "info") =>
    setLog(l => [...l.slice(-80), { t: Date.now(), text, tone }])

  const patch = (id: StageId, s: Partial<StageState>) =>
    setStages(prev => ({ ...prev, [id]: { ...prev[id], ...s } }))

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setStages(idle()); setReports({}); setDebate([]); setVerdict(null); setRisk(null)
    setResult(null); setError(null); setLog([]); setCurrentRound(0); setRunning(false); setStartedAt(null)
  }, [])

  const handle = (e: PipelineEvent) => {
    if (e.type === "stage" && e.stage) {
      const id = e.stage
      const label = LABEL[id] + (e.round ? `, round ${e.round}` : "")
      if (e.status === "running") {
        patch(id, { status: "running", startedAt: Date.now(), round: e.round, throttle: undefined, message: undefined })
        if (e.round) setCurrentRound(e.round)
        push(`${label} started`)
      } else if (e.status === "done") {
        patch(id, { status: "done", elapsed: e.elapsed, throttle: undefined })
        push(`${label} finished${e.elapsed ? ` in ${e.elapsed}s` : ""}`, "ok")
        if (id === "fundamentals" || id === "technical" || id === "news") {
          setReports(r => ({ ...r, [id]: e.payload as AnalystReport }))
        } else if ((id === "bull" || id === "bear") && e.round) {
          const entry: DebateEntry = { side: id, round: e.round, argument: e.payload as DebateArgument }
          setDebate(d => [...d.filter(x => !(x.side === id && x.round === e.round)), entry])
        } else if (id === "judge") {
          setVerdict(e.payload as Verdict)
        } else if (id === "risk") {
          setRisk(e.payload as RiskPlan)
        }
      } else if (e.status === "error") {
        patch(id, { status: "error", message: e.message })
        push(`${label} failed: ${e.message ?? "unknown error"}`, "err")
        if (id !== "fetch_data" && e.payload) setReports(r => ({ ...r, [id]: e.payload as AnalystReport }))
      }
    } else if (e.type === "throttle" && e.stage) {
      patch(e.stage, { throttle: e.wait })
      push(`${LABEL[e.stage]} waiting ${Math.round(e.wait ?? 0)}s for an AI rate-limit slot`, "warn")
    } else if (e.type === "debate_start") {
      setMaxRounds(e.max_rounds ?? 2)
      push(`Debate starts, up to ${e.max_rounds} rounds`, "info")
    } else if (e.type === "round_end") {
      push(`Round ${e.round} closed: bull ${e.bull_confidence}, bear ${e.bear_confidence}`, "ok")
      // Bull/bear go idle between rounds so the graph shows the loop
    } else if (e.type === "complete") {
      const r = e.result as AnalysisResult
      setResult(r)
      if (r?.verdict) setVerdict(r.verdict)
      if (r?.risk_plan) setRisk(r.risk_plan)
      push(`Analysis complete in ${r?.duration_sec ?? "?"}s`, "ok")
    } else if (e.type === "error") {
      setError(e.message ?? "Analysis failed")
      push(e.message ?? "Analysis failed", "err")
    }
  }

  const run = useCallback(async (symbol: string, rounds: number) => {
    reset()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    setMaxRounds(rounds)
    setStartedAt(Date.now())
    push(`Analysing ${symbol} with ${rounds} debate round${rounds > 1 ? "s" : ""}`)
    try {
      await streamEvents("/analyse", handle, { body: { symbol, rounds }, signal: ctrl.signal })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    push("Stopped following. The analysis keeps running on the server and will appear in History.", "warn")
  }, [])

  /** Load a saved analysis into the same view (no streaming). */
  const load = useCallback((r: AnalysisResult) => {
    abortRef.current?.abort()
    const done = Object.fromEntries(STAGES.map(s => [s, { status: "done" as StageStatus }])) as Record<StageId, StageState>
    setStages(done); setReports(r.analyst_reports ?? {}); setDebate(r.debate ?? []); setVerdict(r.verdict)
    setRisk(r.risk_plan); setResult(r); setError(null); setRunning(false); setMaxRounds(r.rounds ?? 1)
    setCurrentRound(r.rounds ?? 1); setLog([]); setStartedAt(null)
  }, [])

  return { stages, reports, debate, verdict, risk, result, error, running, maxRounds, currentRound, log,
           startedAt, run, cancel, load, reset }
}

export type AnalysisStream = ReturnType<typeof useAnalysisStream>
