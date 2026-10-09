import { useCallback, useEffect, useRef, useState } from "react"

/** Minimal data loader: runs `fn` on mount / when deps change; exposes reload + local setter. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { enabled?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(opts.enabled !== false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const reload = useCallback(async (silent = false) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    setError(null)
    try {
      const d = await fnRef.current()
      if (id === seq.current) setData(d)
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (opts.enabled === false) return
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload, setData }
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Re-render every `ms` (for live timers). */
export function useTick(ms: number, active = true) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set(x => x + 1), ms)
    return () => clearInterval(t)
  }, [ms, active])
}
