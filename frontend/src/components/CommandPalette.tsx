// =============================================================================
// Ctrl+K command palette: symbol search + navigation
// =============================================================================

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowElbowDownLeft, MagnifyingGlass } from "@phosphor-icons/react"
import { useDebounced } from "../hooks/useAsync"
import { api } from "../lib/api"
import { useAppData } from "../lib/appData"
import { cx, ticker } from "../lib/format"
import type { SearchResult } from "../lib/types"
import { NAV } from "./layout"

type Item =
  | { kind: "stock"; id: string; r: SearchResult }
  | { kind: "analyse"; id: string; r: SearchResult }
  | { kind: "nav"; id: string; label: string; to: string }

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useAppData()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const dq = useDebounced(q, 120)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (paletteOpen) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 20) }
  }, [paletteOpen])

  useEffect(() => {
    if (!dq.trim()) { setResults([]); return }
    let alive = true
    api.search(dq).then(r => alive && setResults(r)).catch(() => alive && setResults([]))
    return () => { alive = false }
  }, [dq])

  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    results.forEach(r => out.push({ kind: "stock", id: `s-${r.symbol}`, r }))
    if (results[0]) out.splice(1, 0, { kind: "analyse", id: `a-${results[0].symbol}`, r: results[0] })
    const ql = q.toLowerCase()
    NAV.filter(n => !q || n.label.toLowerCase().includes(ql)).forEach(n => out.push({ kind: "nav", id: `n-${n.to}`, label: n.label, to: n.to }))
    return out
  }, [results, q])

  useEffect(() => setActive(0), [items.length])

  const choose = (it: Item) => {
    setPaletteOpen(false)
    if (it.kind === "nav") navigate(it.to)
    else if (it.kind === "stock") navigate(`/stock/${encodeURIComponent(it.r.symbol)}`)
    else navigate(`/stock/${encodeURIComponent(it.r.symbol)}?debate=1`)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    if (e.key === "Enter" && items[active]) choose(items[active])
    if (e.key === "Escape") setPaletteOpen(false)
  }

  const firstNav = items.findIndex(i => i.kind === "nav")

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 px-4 pt-[14vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
          onMouseDown={() => setPaletteOpen(false)}>
          <motion.div role="dialog" aria-label="Search" onMouseDown={e => e.stopPropagation()}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-lg overflow-hidden rounded-lg border border-line-strong bg-surface shadow-[var(--shadow)]">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <MagnifyingGlass className="h-4 w-4 text-fg-3" />
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
                aria-label="Search stocks"
                placeholder="Company or ticker, e.g. Infosys, HDFCBANK"
                className="h-12 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-3 outline-none" />
              <kbd className="kbd">Esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1.5">
              {items.map((it, i) => (
                <li key={it.id}>
                  {i === firstNav && <p className="px-4 pb-1 pt-2.5 text-[11px] text-fg-3">Go to</p>}
                  <button onMouseEnter={() => setActive(i)} onClick={() => choose(it)}
                    className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", i === active && "bg-surface-2")}>
                    {it.kind === "stock" && (
                      <>
                        <span className="num w-24 shrink-0 text-[13px] text-fg">{ticker(it.r.symbol)}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{it.r.name}</span>
                        {it.r.sector && <span className="text-xs text-fg-3">{it.r.sector}</span>}
                      </>
                    )}
                    {it.kind === "analyse" && (
                      <span className="flex-1 text-[13px] text-fg">
                        Run AI analysis on <span className="num">{ticker(it.r.symbol)}</span>
                      </span>
                    )}
                    {it.kind === "nav" && <span className="flex-1 text-[13px] text-fg-2">{it.label}</span>}
                    {i === active && <ArrowElbowDownLeft className="h-3.5 w-3.5 text-fg-3" />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
