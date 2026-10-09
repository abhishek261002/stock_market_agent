// =============================================================================
// App-wide data: market overview (auto-refresh), API config, palette state
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api } from "./api"
import type { MarketOverview } from "./types"

interface Config {
  model: string
  models?: { chain: string[]; active: string | null; exhausted: string[]; demo: boolean }
  default_rounds: number
  max_rounds: number
  disclaimer: string
  llm_rpm?: number
}

interface AppData {
  market: MarketOverview | null
  marketError: string | null
  config: Config | null
  refreshMarket: () => void
  refreshConfig: () => void
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [market, setMarket] = useState<MarketOverview | null>(null)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const refreshMarket = useCallback(() => {
    api.market().then(m => { setMarket(m); setMarketError(null) }).catch(e => setMarketError(e.message))
  }, [])
  const refreshConfig = useCallback(() => {
    api.config().then(setConfig).catch(() => { /* backend down — banner shown elsewhere */ })
  }, [])

  useEffect(() => {
    refreshMarket()
    refreshConfig()
    const t = setInterval(refreshMarket, 90_000)
    return () => clearInterval(t)
  }, [refreshMarket, refreshConfig])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <Ctx.Provider value={{ market, marketError, config, refreshMarket, refreshConfig, paletteOpen, setPaletteOpen }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAppData outside provider")
  return v
}
