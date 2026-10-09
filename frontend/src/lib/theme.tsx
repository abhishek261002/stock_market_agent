// =============================================================================
// Theme: system / light / dark, persisted per browser
// =============================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type ThemeMode = "system" | "light" | "dark"
type Resolved = "light" | "dark"

const KEY = "arena-theme"
const Ctx = createContext<{ mode: ThemeMode; resolved: Resolved; setMode: (m: ThemeMode) => void } | null>(null)

function systemTheme(): Resolved {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" || v === "system" ? v : "system"
  } catch { return "system" }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  const [system, setSystem] = useState<Resolved>(systemTheme)
  const resolved: Resolved = mode === "system" ? system : mode

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)")
    const on = () => setSystem(mq.matches ? "light" : "dark")
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  useEffect(() => { document.documentElement.dataset.theme = resolved }, [resolved])

  const setMode = (m: ThemeMode) => {
    setModeState(m)
    try { localStorage.setItem(KEY, m) } catch { /* private mode */ }
  }

  return <Ctx.Provider value={{ mode, resolved, setMode }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useTheme outside ThemeProvider")
  return v
}

/** Reads a design token (CSS custom property) at runtime, for canvas charts. */
// eslint-disable-next-line react-refresh/only-export-components
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
}
