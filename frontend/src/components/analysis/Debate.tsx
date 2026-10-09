// =============================================================================
// Analyst reports, debate transcript, news list
// =============================================================================

import { motion } from "motion/react"
import { ArrowSquareOut } from "@phosphor-icons/react"
import { clean, cx, stanceColor, timeAgo } from "../../lib/format"
import type { AnalystReport, DebateEntry, Headline } from "../../lib/types"
import { Meter, Skeleton } from "../ui"

const ANALYSTS = [
  { key: "fundamentals" as const, label: "Fundamentals" },
  { key: "technical" as const, label: "Technicals" },
  { key: "news" as const, label: "News and sentiment" },
]

const stanceWord = { bullish: "Bullish", neutral: "Neutral", bearish: "Bearish" }

export function AnalystReports({ reports, running }: {
  reports: Partial<Record<"fundamentals" | "technical" | "news", AnalystReport>>; running: boolean
}) {
  return (
    <div className="divide-y divide-line">
      {ANALYSTS.map(a => {
        const r = reports[a.key]
        return (
          <article key={a.key} className="grid gap-x-8 gap-y-3 px-5 py-5 md:grid-cols-[180px_1fr]">
            <header>
              <h3 className="text-[13px] font-medium text-fg">{a.label}</h3>
              {r ? (
                <>
                  <p className={cx("mt-1 text-[13px]", stanceColor[r.stance])}>{stanceWord[r.stance]}</p>
                  <p className="num mt-2 text-xs text-fg-3">{r.score.toFixed(1)} / 10 bullish</p>
                  <Meter value={r.score} tone={r.score >= 6 ? "up" : r.score <= 4 ? "down" : "fg"} className="mt-1.5 w-28" />
                </>
              ) : <p className="mt-1 text-xs text-fg-3">{running ? "Working" : "Pending"}</p>}
            </header>
            {!r ? (
              <div className="space-y-2 pt-0.5">
                <Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
              </div>
            ) : (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-w-0">
                <p className="text-[14px] font-medium leading-snug text-fg">{clean(r.headline)}</p>
                <p className="mt-1.5 max-w-[75ch] text-[13px] leading-relaxed text-fg-2">{clean(r.summary)}</p>
                <ul className="mt-3 grid gap-x-8 gap-y-1.5 lg:grid-cols-2">
                  {r.key_points.slice(0, 6).map((p, j) => (
                    <li key={j} className="flex gap-2 text-[12.5px] leading-snug text-fg-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg-3" />{clean(p)}
                    </li>
                  ))}
                </ul>
                {r.red_flags.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {r.red_flags.slice(0, 3).map((p, j) => (
                      <li key={j} className="text-[12.5px] leading-snug text-fg-2">
                        <span className="text-down">Watch:</span> {clean(p)}
                      </li>
                    ))}
                  </ul>
                )}
                {a.key === "news" && r.searches && r.searches.length > 1 && (
                  <p className="mt-3 text-xs text-fg-3">
                    Searched: {r.searches.map((s, i) => <span key={s}>{i > 0 && ", "}<span className="text-fg-2">"{s}"</span></span>)}
                  </p>
                )}
              </motion.div>
            )}
          </article>
        )
      })}
    </div>
  )
}

export function DebateTranscript({ debate, maxRounds, running, currentRound }: {
  debate: DebateEntry[]; maxRounds: number; running: boolean; currentRound: number
}) {
  const rounds = Array.from(new Set(debate.map(d => d.round))).sort((a, b) => a - b)
  const pending = running && currentRound > 0 && debate.filter(d => d.round === currentRound).length < 2
  if (pending && !rounds.includes(currentRound)) rounds.push(currentRound)
  return (
    <div>
      <ConfidenceSummary debate={debate} maxRounds={maxRounds} />
      {rounds.map(r => (
        <section key={r} className="border-t border-line">
          <h3 className="px-5 pt-4 text-xs text-fg-3">Round {r}, {r === 1 ? "opening arguments" : "rebuttals"}</h3>
          <div className="grid md:grid-cols-2 md:divide-x md:divide-line">
            <Argument side="bull" entry={debate.find(d => d.round === r && d.side === "bull")} />
            <Argument side="bear" entry={debate.find(d => d.round === r && d.side === "bear")} />
          </div>
        </section>
      ))}
    </div>
  )
}

function Argument({ side, entry }: { side: "bull" | "bear"; entry?: DebateEntry }) {
  const a = entry?.argument
  const tone = side === "bull" ? "text-up" : "text-down"
  return (
    <article className="px-5 pb-5 pt-3">
      <header className="flex items-baseline justify-between gap-4">
        <h4 className={cx("text-[13px] font-medium", tone)}>{side === "bull" ? "Bull case" : "Bear case"}</h4>
        {a && <span className="num text-xs text-fg-3">confidence <span className="text-fg">{a.confidence.toFixed(1)}</span></span>}
      </header>
      {!a ? (
        <div className="mt-3 space-y-2"><Skeleton className="h-4 w-5/6" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/6" /></div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <p className="mt-2 text-[14px] leading-snug text-fg">{clean(a.thesis)}</p>
          {a.rebuttal && (
            <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-fg-2">
              {clean(a.rebuttal)}
            </blockquote>
          )}
          <ol className="mt-3 space-y-2.5">
            {a.points.map((p, i) => (
              <li key={i} className="grid grid-cols-[18px_1fr] gap-1 text-[13px]">
                <span className="num text-fg-3">{i + 1}</span>
                <div>
                  <p className="font-medium text-fg">{clean(p.title)}</p>
                  <p className="mt-0.5 leading-relaxed text-fg-2">{clean(p.detail)}</p>
                </div>
              </li>
            ))}
          </ol>
          {a.concession && <p className="mt-3 text-[12.5px] text-fg-3">Concedes: {clean(a.concession)}</p>}
        </motion.div>
      )}
    </article>
  )
}

function ConfidenceSummary({ debate, maxRounds }: { debate: DebateEntry[]; maxRounds: number }) {
  const rounds = Array.from({ length: Math.max(maxRounds, ...debate.map(d => d.round), 1) }, (_, i) => i + 1)
  const get = (side: string, r: number) => debate.find(d => d.side === side && d.round === r)?.argument.confidence
  const latest = (side: string) => [...debate].filter(d => d.side === side).sort((a, b) => b.round - a.round)[0]?.argument.confidence
  const lb = latest("bull"), lr = latest("bear")
  const share = lb !== undefined && lr !== undefined ? (lb / ((lb + lr) || 1)) * 100 : 50
  return (
    <div className="grid gap-4 px-5 pb-4 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <div className="num mb-1.5 flex justify-between text-xs">
          <span className="text-up">Bull {lb?.toFixed(1) ?? "-"}</span>
          <span className="text-down">{lr?.toFixed(1) ?? "-"} Bear</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-down">
          <motion.div className="h-full bg-up" initial={{ width: "50%" }} animate={{ width: `${share}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
        </div>
      </div>
      <dl className="num flex gap-5 text-xs">
        {rounds.map(r => (
          <div key={r}>
            <dt className="text-fg-3">Round {r}</dt>
            <dd className="mt-0.5"><span className="text-up">{get("bull", r)?.toFixed(1) ?? "-"}</span>
              <span className="text-fg-3"> / </span><span className="text-down">{get("bear", r)?.toFixed(1) ?? "-"}</span></dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function NewsList({ headlines, limit = 20 }: { headlines: Headline[]; limit?: number }) {
  const tone = { positive: "text-up", neutral: "text-fg-3", negative: "text-down" }
  const word = { positive: "Positive", neutral: "Neutral", negative: "Negative" }
  return (
    <ul className="divide-y divide-line">
      {headlines.slice(0, limit).map(h => (
        <li key={h.title}>
          <a href={h.link ?? undefined} target="_blank" rel="noreferrer"
            className="group grid grid-cols-[1fr_auto] gap-4 px-5 py-3 transition-colors hover:bg-surface-2">
            <div className="min-w-0">
              <p className="text-[13px] leading-snug text-fg">{clean(h.title)}</p>
              <p className="mt-1 text-xs text-fg-3">
                {h.source}{h.published && `, ${timeAgo(h.published)}`}
                {h.sentiment && <span className={cx("ml-2", tone[h.sentiment])}>{word[h.sentiment]}{h.impact && h.sentiment !== "neutral" ? `, ${h.impact} impact` : ""}</span>}
              </p>
            </div>
            <ArrowSquareOut className="mt-0.5 h-3.5 w-3.5 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        </li>
      ))}
    </ul>
  )
}
