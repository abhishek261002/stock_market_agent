// =============================================================================
// src/lib/api.ts — typed API client + Server-Sent-Events stream reader
// =============================================================================

import type {
  Alert, AnalysisResult, AnalysisSummary, BacktestResult, CompareResult, MarketOverview, PipelineEvent,
  Preset, PriceAlert, RankedPick, ScreenerFilters, ScreenerRow, SearchResult, StockDetail, WatchItem,
} from "./types"

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, "Cannot reach the API server. Is the backend running on port 8000?")
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body)
    } catch { /* not JSON */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) })
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" })
const enc = encodeURIComponent

/**
 * Opens an SSE stream (GET or POST) and calls onEvent for every `data:` JSON payload.
 * Resolves when the server closes the stream. Abort with the signal.
 */
export async function streamEvents(
  path: string,
  onEvent: (e: PipelineEvent) => void,
  opts: { body?: unknown; signal?: AbortSignal } = {},
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === "AbortError") return
    throw new ApiError(0, "Cannot reach the API server. Is the backend running on port 8000?")
  }
  if (!res.ok || !res.body) {
    let msg = res.statusText
    try { msg = (await res.json()).detail ?? msg } catch { /* ignore */ }
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg))
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        try { onEvent(JSON.parse(raw) as PipelineEvent) } catch { /* malformed chunk */ }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e
  }
}

export const api = {
  config: () => request<{ model: string; default_rounds: number; max_rounds: number; disclaimer: string }>("/config"),
  market: () => request<MarketOverview>("/market/overview"),
  search: (q: string) => request<SearchResult[]>(`/search?q=${enc(q)}`),
  stock: (symbol: string) => request<StockDetail>(`/stock/${enc(symbol)}`),

  analyses: (symbol?: string) => request<AnalysisSummary[]>(`/analyses${symbol ? `?symbol=${enc(symbol)}` : ""}`),
  analysis: (id: string) => request<AnalysisResult>(`/analyses/${enc(id)}`),
  deleteAnalysis: (id: string) => del(`/analyses/${enc(id)}`),

  presets: () => request<Preset[]>("/screener/presets"),
  parseQuery: (query: string) => post<ScreenerFilters>("/screener/parse", { query }),
  rank: (symbols: string[], query: string) =>
    post<{ summary: string; picks: RankedPick[] }>("/screener/rank", { symbols, query }),

  compare: (symbols: string[]) => post<CompareResult>("/compare", { symbols }),
  backtests: () => request<Pick<BacktestResult, "id" | "symbol" | "created_at" | "metrics" | "horizon_days">[]>("/backtests"),
  backtest: (id: string) => request<BacktestResult>(`/backtests/${enc(id)}`),

  watchlist: () => request<WatchItem[]>("/watchlist"),
  watch: (symbol: string) => post<{ added: string }>("/watchlist", { symbol }),
  unwatch: (symbol: string) => del<{ removed: string }>(`/watchlist/${enc(symbol)}`),
  refreshWatchlist: () => post<{ status: string }>("/watchlist/refresh", {}),

  alerts: () => request<{ items: Alert[]; unread: number }>("/alerts"),
  readAlerts: (ids?: number[]) => post("/alerts/read", { ids: ids ?? null }),
  priceAlerts: () => request<PriceAlert[]>("/price-alerts"),
  addPriceAlert: (symbol: string, direction: "above" | "below", price: number) =>
    post<{ id: number }>("/price-alerts", { symbol, direction, price }),
  deletePriceAlert: (id: number) => del(`/price-alerts/${id}`),
}

export type { ScreenerRow }
