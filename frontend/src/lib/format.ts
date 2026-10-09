// =============================================================================
// src/lib/format.ts — Indian-market number formatting & semantic colours
// =============================================================================

import type { Action, Stance } from "./types"

/** Placeholder for missing values (a plain hyphen, never an em-dash). */
export const NA = "-"

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })
const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

export function inr(v: number | null | undefined, opts: { decimals?: number; symbol?: boolean } = {}): string {
  if (!isNum(v)) return NA
  const d = opts.decimals ?? 2
  const s = d === 2 ? inrFmt.format(v) : new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: d, minimumFractionDigits: d }).format(v)
  return opts.symbol === false ? s : `₹${s}`
}

export function int(v: number | null | undefined): string {
  return isNum(v) ? intFmt.format(v) : NA
}

/** Market cap in rupees → "₹4.15L Cr" / "₹23,456 Cr" */
export function crore(v: number | null | undefined): string {
  if (!isNum(v)) return NA
  const cr = v / 1e7
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L Cr`
  return `₹${intFmt.format(cr)} Cr`
}

/** Compact volumes: 1.2Cr, 34L */
export function compact(v: number | null | undefined): string {
  if (!isNum(v)) return NA
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v)
}

export function pct(v: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}): string {
  if (!isNum(v)) return NA
  const d = opts.decimals ?? 2
  const sign = opts.sign !== false && v > 0 ? "+" : ""
  return `${sign}${v.toFixed(d)}%`
}

export function num(v: number | null | undefined, decimals = 2, suffix = ""): string {
  return isNum(v) ? `${v.toFixed(decimals)}${suffix}` : NA
}

export const ticker = (symbol: string) => symbol.replace(/\.(NS|BO)$/, "")

export function upDown(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return "text-fg-2"
  return v > 0 ? "text-up" : "text-down"
}

/** BUY = up, SELL = down, HOLD = neutral. One accent is reserved for UI, not verdicts. */
export const actionColor: Record<Action, { text: string; soft: string; border: string; varName: string }> = {
  BUY:  { text: "text-up",   soft: "bg-up-soft",   border: "border-up",   varName: "up" },
  HOLD: { text: "text-fg",   soft: "bg-surface-3", border: "border-line-strong", varName: "fg-2" },
  SELL: { text: "text-down", soft: "bg-down-soft", border: "border-down", varName: "down" },
}

export const actionWord: Record<Action, string> = { BUY: "Buy", HOLD: "Hold", SELL: "Sell" }

export const stanceColor: Record<Stance, string> = {
  bullish: "text-up",
  neutral: "text-fg-2",
  bearish: "text-down",
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

export function dateShort(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
}

/** Heatmap fill for a % change, clamped to ±3%, theme-aware via CSS variables. */
export function heat(v: number): string {
  const c = Math.min(1, Math.abs(v) / 3)
  const pctMix = Math.round(6 + c * 34)
  return `color-mix(in oklab, var(${v >= 0 ? "--up" : "--down"}) ${pctMix}%, var(--surface))`
}

/** Strips list markers LLMs sometimes prepend ("1. ", "- ") and em-dashes in display text. */
export function clean(s: string): string {
  return s.replace(/^\s*(?:\d+[.)]|[-•*])\s+/, "").replace(/\s*—\s*|\s+–\s+/g, ", ").replace(/(\d)–(₹?\d)/g, "$1-$2")
}

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ")
