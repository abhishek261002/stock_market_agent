import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { useDebounced } from "../hooks/useAsync"
import { api } from "../lib/api"
import { ticker } from "../lib/format"
import type { SearchResult } from "../lib/types"

export function SymbolPicker({ onPick, placeholder = "Add a stock", exclude = [], label }: {
  onPick: (symbol: string) => void; placeholder?: string; exclude?: string[]; label?: string
}) {
  const [q, setQ] = useState("")
  const [res, setRes] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const dq = useDebounced(q, 120)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dq.trim()) { setRes([]); return }
    api.search(dq).then(r => setRes(r.filter(x => !exclude.includes(x.symbol)))).catch(() => setRes([]))
  }, [dq]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  const pick = (s: string) => { onPick(s); setQ(""); setRes([]); setOpen(false) }

  return (
    <div ref={box} className="relative w-full max-w-60">
      {label && <label className="label mb-1.5 block">{label}</label>}
      <div className="relative">
        <MagnifyingGlass className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === "Enter" && res[0]) pick(res[0].symbol) }}
          aria-label={label ?? placeholder} placeholder={placeholder} className="input pl-8" />
      </div>
      <AnimatePresence>
        {open && res.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md border border-line-strong bg-surface py-1 shadow-[var(--shadow)]">
            {res.map(r => (
              <li key={r.symbol}>
                <button onClick={() => pick(r.symbol)} className="flex w-full items-baseline gap-2.5 px-3 py-1.5 text-left hover:bg-surface-2">
                  <span className="num text-[13px] text-fg">{ticker(r.symbol)}</span>
                  <span className="truncate text-xs text-fg-3">{r.name}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
