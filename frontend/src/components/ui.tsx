// =============================================================================
// Shared UI primitives
// =============================================================================

import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react"
import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { CircleNotch, WarningCircle } from "@phosphor-icons/react"
import { actionColor, actionWord, cx, isNum, NA, pct, upDown } from "../lib/format"
import type { Action } from "../lib/types"

const EASE = [0.16, 1, 0.3, 1] as const

// ─── Panel ────────────────────────────────────────────────────────────────────
export function Panel({ children, className, as = "section" }: {
  children: ReactNode; className?: string; as?: "section" | "div" | "article"
}) {
  const C = as === "div" ? motion.div : as === "article" ? motion.article : motion.section
  return (
    <C initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}
      className={cx("panel", className)}>
      {children}
    </C>
  )
}

export function PanelHeader({ title, sub, right, className }: {
  title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string
}) {
  return (
    <header className={cx("flex items-start gap-4 px-5 pb-3 pt-4", className)}>
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-medium text-fg">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-fg-3">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  )
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {sub && <p className="mt-1 max-w-[65ch] text-[13px] text-fg-2">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

// ─── Numbers ──────────────────────────────────────────────────────────────────
export function AnimatedNumber({ value, format, className }: {
  value: number | null | undefined; format: (v: number) => string; className?: string
}) {
  const mv = useMotionValue(isNum(value) ? value : 0)
  const text = useTransform(mv, v => format(v))
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  useEffect(() => {
    if (!isNum(value) || !inView) return
    const c = animate(mv, value, { duration: 0.6, ease: EASE })
    return () => c.stop()
  }, [value, inView, mv])
  if (!isNum(value)) return <span className={className}>{NA}</span>
  return <motion.span ref={ref} className={cx("num", className)}>{text}</motion.span>
}

export function Change({ value, className, decimals = 2 }: { value: number | null | undefined; className?: string; decimals?: number }) {
  return <span className={cx("num", upDown(value), className)}>{pct(value, { decimals })}</span>
}

// ─── Verdict badge ────────────────────────────────────────────────────────────
export function VerdictBadge({ verdict, confidence, size = "sm" }: {
  verdict: Action | null | undefined; confidence?: number | null; size?: "sm" | "md"
}) {
  if (!verdict) return <span className="text-xs text-fg-3">{NA}</span>
  const c = actionColor[verdict]
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-[4px] font-medium", c.soft, c.text,
      size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-[13px]")}>
      {actionWord[verdict]}
      {isNum(confidence) && <span className="num opacity-70">{confidence.toFixed(1)}</span>}
    </span>
  )
}

// ─── Sparkline (stroke only) ──────────────────────────────────────────────────
export function Sparkline({ data, width = 96, height = 28, tone }: {
  data: number[]; width?: number; height?: number; tone?: "up" | "down" | "neutral"
}) {
  const { path, up } = useMemo(() => {
    const d = data.filter(isNum)
    if (d.length < 2) return { path: "", up: true }
    const min = Math.min(...d), max = Math.max(...d)
    const span = max - min || 1
    const p = d.map((v, i) => `${i ? "L" : "M"}${((i / (d.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ")
    return { path: p, up: d[d.length - 1] >= d[0] }
  }, [data, width, height])
  const t = tone ?? (up ? "up" : "down")
  if (!path) return <span style={{ width, height }} className="inline-block" />
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block">
      <path d={path} fill="none" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
        stroke={t === "neutral" ? "var(--fg-3)" : `var(--${t})`} />
    </svg>
  )
}

// ─── Meter ────────────────────────────────────────────────────────────────────
export function Meter({ value, max = 10, tone = "accent", className }: {
  value: number | null | undefined; max?: number; tone?: "accent" | "up" | "down" | "fg"; className?: string
}) {
  const w = isNum(value) ? Math.max(0, Math.min(1, value / max)) : 0
  const bg = { accent: "bg-accent", up: "bg-up", down: "bg-down", fg: "bg-fg-2" }[tone]
  return (
    <div className={cx("h-1 overflow-hidden rounded-full bg-surface-3", className)}>
      <motion.div className={cx("h-full origin-left rounded-full", bg)} style={{ width: "100%" }}
        initial={{ scaleX: 0 }} animate={{ scaleX: w }} transition={{ duration: 0.6, ease: EASE }} />
    </div>
  )
}

// ─── Tabs (underline) ─────────────────────────────────────────────────────────
export function Tabs<T extends string>({ tabs, value, onChange, id }: {
  tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; id: string
}) {
  return (
    <div role="tablist" className="flex gap-5 overflow-x-auto border-b border-line">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("relative -mb-px flex items-center gap-1.5 whitespace-nowrap pb-2.5 pt-1 text-[13px] transition-colors",
            value === t.id ? "text-fg" : "text-fg-3 hover:text-fg-2")}>
          {t.label}
          {value === t.id && (
            <motion.span layoutId={`tab-${id}`} className="absolute inset-x-0 -bottom-px h-0.5 bg-accent"
              transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          )}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md border border-line bg-surface p-0.5">
      {options.map(o => (
        <button key={String(o.id)} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cx("num h-full rounded-[4px] px-2.5 text-xs transition-colors",
            value === o.id ? "bg-surface-3 text-fg" : "text-fg-3 hover:text-fg-2")}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── States ───────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />
}

export function Spinner({ className }: { className?: string }) {
  return <CircleNotch className={cx("animate-spin", className ?? "h-4 w-4")} />
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-down/40 bg-down-soft px-4 py-3">
      <WarningCircle className="mt-0.5 h-4 w-4 shrink-0 text-down" weight="bold" />
      <p className="flex-1 text-[13px] text-fg">{message}</p>
      {onRetry && <button onClick={onRetry} className="text-[13px] font-medium text-fg underline-offset-2 hover:underline">Try again</button>}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-12">
      <p className="text-[14px] font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-[52ch] text-[13px] text-fg-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Label/value pair for stat grids (no boxes). */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label truncate">{label}</dt>
      <dd className="num mt-1 truncate text-[15px] text-fg">{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-[11px] text-fg-3">{sub}</dd>}
    </div>
  )
}
