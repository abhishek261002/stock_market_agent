// =============================================================================
// App shell: top bar, index strip, alerts, display menu, mobile nav
// =============================================================================

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, NavLink, useNavigate } from "react-router-dom"
import {
  Bell, BookmarkSimple, ClockCounterClockwise, Faders, Flask, GitDiff, MagnifyingGlass, Monitor, SquaresFour,
} from "@phosphor-icons/react"
import { api } from "../lib/api"
import { useAppData } from "../lib/appData"
import { cx, inr, pct, timeAgo } from "../lib/format"
import { useTheme, type ThemeMode } from "../lib/theme"
import type { Alert } from "../lib/types"

export const NAV = [
  { to: "/", label: "Markets", icon: SquaresFour, end: true },
  { to: "/screener", label: "Screener", icon: Faders },
  { to: "/compare", label: "Compare", icon: GitDiff },
  { to: "/backtest", label: "Backtest", icon: Flask },
  { to: "/watchlist", label: "Watchlist", icon: BookmarkSimple },
  { to: "/history", label: "History", icon: ClockCounterClockwise },
]

export function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Arena home">
      <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-accent text-[13px] font-semibold text-accent-fg">A</span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">Arena</span>
    </Link>
  )
}

export function TopBar() {
  const { setPaletteOpen } = useAppData()
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 md:px-6">
        <Wordmark />
        <nav aria-label="Primary" className="hidden h-full items-center gap-5 lg:flex">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx("relative flex h-full items-center text-[13px] transition-colors",
                isActive ? "text-fg" : "text-fg-3 hover:text-fg-2")}>
              {({ isActive }) => (
                <>
                  {n.label}
                  {isActive && <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-px h-0.5 bg-accent"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-44 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg-3 transition-colors hover:border-line-strong md:w-64">
            <MagnifyingGlass className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search stocks</span>
            <kbd className="kbd hidden md:inline">Ctrl K</kbd>
          </button>
          <AlertsMenu />
          <DisplayMenu />
        </div>
      </div>
      <IndexStrip />
    </header>
  )
}

function IndexStrip() {
  const { market } = useAppData()
  return (
    <div className="border-t border-line">
      <div className="mx-auto flex h-9 max-w-[1440px] items-center gap-6 overflow-x-auto px-4 md:px-6">
        {market ? market.indices.map(ix => (
          <div key={ix.symbol} className="flex shrink-0 items-baseline gap-2 text-xs">
            <span className="text-fg-3">{ix.name}</span>
            <span className="num text-fg">{inr(ix.price, { symbol: ix.symbol === "USDINR=X" })}</span>
            <span className={cx("num", ix.change_pct >= 0 ? "text-up" : "text-down")}>{pct(ix.change_pct)}</span>
          </div>
        )) : <span className="text-xs text-fg-3">Loading indices</span>}
        {market?.status && (
          <span className="ml-auto shrink-0 whitespace-nowrap pl-4 text-xs text-fg-3">
            <span className={market.status.open ? "text-up" : ""}>{market.status.label}</span><span className="num">, {market.status.time_ist.split(", ").pop()}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.parentElement?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc) }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={box} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14 }}
          className={cx("absolute right-0 top-10 z-40 rounded-lg border border-line-strong bg-surface shadow-[var(--shadow)]", className)}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DisplayMenu() {
  const [open, setOpen] = useState(false)
  const { mode, setMode } = useTheme()
  const opts: { id: ThemeMode; label: string }[] = [
    { id: "system", label: "Match system" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
  ]
  return (
    <div className="relative">
      <button aria-label="Display settings" onClick={() => setOpen(o => !o)}
        className="grid h-8 w-8 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
        <Monitor className="h-4 w-4" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-48 p-1">
        <p className="px-2.5 pb-1 pt-1.5 text-xs text-fg-3">Appearance</p>
        {opts.map(o => (
          <button key={o.id} onClick={() => { setMode(o.id); setOpen(false) }}
            className={cx("flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition-colors hover:bg-surface-2",
              mode === o.id ? "text-fg" : "text-fg-2")}>
            {o.label}
            {mode === o.id && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </Popover>
    </div>
  )
}

function AlertsMenu() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Alert[]>([])
  const [unread, setUnread] = useState(0)
  const navigate = useNavigate()

  const load = () => api.alerts().then(r => { setItems(r.items); setUnread(r.unread) }).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  const markAll = async () => { await api.readAlerts(); load() }

  return (
    <div className="relative">
      <button aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} onClick={() => setOpen(o => !o)}
        className="relative grid h-8 w-8 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="num absolute right-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-[3px] bg-accent px-0.5 text-[9px] font-semibold text-accent-fg">
            {unread}
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-[340px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="text-[13px] font-medium">Alerts</p>
          {unread > 0 && <button onClick={markAll} className="text-xs text-fg-2 hover:text-fg">Mark all read</button>}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {items.length === 0 && (
            <p className="px-4 py-8 text-[13px] text-fg-2">
              Nothing yet. Stocks on your watchlist alert you when the verdict changes or a price level is crossed.
            </p>
          )}
          {items.map(a => (
            <button key={a.id}
              onClick={() => { setOpen(false); if (a.symbol !== "WATCHLIST") navigate(`/stock/${encodeURIComponent(a.symbol)}`) }}
              className="flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2">
              <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", a.read ? "bg-transparent" : "bg-accent")} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-fg">{a.title}</p>
                {a.message && <p className="mt-0.5 text-xs text-fg-2">{a.message}</p>}
                <p className="mt-1 text-[11px] text-fg-3">{timeAgo(a.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}

export function MobileNav() {
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-bg/95 backdrop-blur-md lg:hidden">
      {NAV.map(n => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[10px]", isActive ? "text-accent" : "text-fg-3")}>
          <n.icon className="h-5 w-5" />{n.label}
        </NavLink>
      ))}
    </nav>
  )
}
