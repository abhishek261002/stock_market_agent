// =============================================================================
// Charts: TradingView lightweight-charts, coloured from design tokens
// =============================================================================

import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
  type DeepPartial, type ChartOptions, type IChartApi, type MouseEventParams, type Time,
} from "lightweight-charts"
import { useEffect, useMemo, useRef, useState } from "react"
import { compact, cx, inr, pct } from "../lib/format"
import { token, useTheme } from "../lib/theme"
import type { Candle } from "../lib/types"
import { Segmented } from "./ui"

function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "")
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function baseOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: token("fg-3"),
      fontFamily: "Geist Mono Variable, ui-monospace, monospace",
      fontSize: 11,
      attributionLogo: false,
      panes: { separatorColor: token("line"), separatorHoverColor: token("line-strong") },
    },
    grid: { vertLines: { visible: false }, horzLines: { color: token("line") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, rightOffset: 3, fixLeftEdge: true },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: token("line-strong"), labelBackgroundColor: token("surface-3"), style: LineStyle.Solid, width: 1 },
      horzLine: { color: token("line-strong"), labelBackgroundColor: token("surface-3"), style: LineStyle.Solid, width: 1 },
    },
  }
}

const RANGES = [
  { id: "1M", days: 22 }, { id: "3M", days: 66 }, { id: "6M", days: 130 },
  { id: "1Y", days: 252 }, { id: "2Y", days: 520 },
] as const
type RangeId = typeof RANGES[number]["id"]

const OVERLAYS = [
  { key: "sma20" as const, label: "20D", tokenName: "fg-3", style: LineStyle.Dotted },
  { key: "sma50" as const, label: "50D", tokenName: "accent", style: LineStyle.Solid },
  { key: "sma200" as const, label: "200D", tokenName: "fg-2", style: LineStyle.Solid },
]

export function PriceChart({ candles, height = 420 }: { candles: Candle[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const { resolved } = useTheme()
  const [range, setRange] = useState<RangeId>("6M")
  const [overlays, setOverlays] = useState<Record<string, boolean>>({ sma20: false, sma50: true, sma200: true })
  const [showRsi, setShowRsi] = useState(true)
  const [legend, setLegend] = useState<Candle | null>(null)

  const last = candles[candles.length - 1]
  const byTime = useMemo(() => new Map(candles.map(c => [c.time, c])), [candles])

  useEffect(() => {
    if (!ref.current || candles.length === 0) return
    const up = token("up"), down = token("down")
    const chart = createChart(ref.current, baseOptions())
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: "price", precision: 2, minMove: 0.05 },
    })
    candleSeries.setData(candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })))

    for (const o of OVERLAYS) {
      if (!overlays[o.key]) continue
      const s = chart.addSeries(LineSeries, {
        color: token(o.tokenName), lineWidth: 1, lineStyle: o.style,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      s.setData(candles.filter(c => c[o.key] !== null).map(c => ({ time: c.time as Time, value: c[o.key] as number })))
    }

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false,
    })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    vol.setData(candles.map(c => ({ time: c.time as Time, value: c.volume, color: alpha(c.close >= c.open ? up : down, 0.28) })))

    if (showRsi) {
      const rsi = chart.addSeries(LineSeries, {
        color: token("fg-2"), lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
      }, 1)
      rsi.setData(candles.filter(c => c.rsi !== null).map(c => ({ time: c.time as Time, value: c.rsi as number })))
      rsi.createPriceLine({ price: 70, color: alpha(down, 0.5), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" })
      rsi.createPriceLine({ price: 30, color: alpha(up, 0.5), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" })
      const panes = chart.panes()
      panes[1]?.setStretchFactor(0.25)
      panes[0]?.setStretchFactor(1)
    }

    const onMove = (p: MouseEventParams) => setLegend(p.time ? byTime.get(String(p.time)) ?? null : null)
    chart.subscribeCrosshairMove(onMove)

    const days = RANGES.find(r => r.id === range)!.days
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - days), to: candles.length + 2 })

    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.remove()
      chartRef.current = null
    }
  }, [candles, overlays, showRsi, range, byTime, resolved])

  const shown = legend ?? last
  const chg = shown ? ((shown.close - shown.open) / shown.open) * 100 : null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3">
        <Segmented label="Range" value={range} onChange={setRange} options={RANGES.map(r => ({ id: r.id, label: r.id }))} />
        <div className="flex flex-wrap items-center gap-1.5">
          {OVERLAYS.map(o => (
            <button key={o.key} onClick={() => setOverlays(s => ({ ...s, [o.key]: !s[o.key] }))}
              aria-pressed={overlays[o.key]} className={cx("toggle", overlays[o.key] && "toggle-on")}>
              <span className="h-px w-3" style={{ background: `var(--${o.tokenName})`, borderTop: o.style === LineStyle.Dotted ? `1px dotted var(--${o.tokenName})` : undefined }} />
              {o.label} avg
            </button>
          ))}
          <button onClick={() => setShowRsi(v => !v)} aria-pressed={showRsi} className={cx("toggle", showRsi && "toggle-on")}>RSI</button>
        </div>
        {shown && (
          <div className="num ml-auto flex flex-wrap gap-x-3 text-[11px] text-fg-3">
            <span>{shown.time}</span>
            <span>O <span className="text-fg-2">{inr(shown.open, { symbol: false })}</span></span>
            <span>H <span className="text-fg-2">{inr(shown.high, { symbol: false })}</span></span>
            <span>L <span className="text-fg-2">{inr(shown.low, { symbol: false })}</span></span>
            <span>C <span className="text-fg">{inr(shown.close, { symbol: false })}</span></span>
            <span className={chg !== null && chg >= 0 ? "text-up" : "text-down"}>{pct(chg)}</span>
            <span>Vol <span className="text-fg-2">{compact(shown.volume)}</span></span>
          </div>
        )}
      </div>
      <div ref={ref} style={{ height }} className="w-full" />
    </div>
  )
}

export interface LineSeriesSpec {
  name: string
  tokenName: string
  style?: "solid" | "dashed" | "dotted"
  width?: 1 | 2 | 3
  data: { time: string; value: number }[]
}

export function MultiLineChart({ series, height = 300 }: { series: LineSeriesSpec[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  useEffect(() => {
    if (!ref.current || series.length === 0) return
    const chart = createChart(ref.current, { ...baseOptions(), timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true } })
    for (const s of series) {
      const line = chart.addSeries(LineSeries, {
        color: token(s.tokenName), lineWidth: s.width ?? 2, priceLineVisible: false, title: s.name,
        lineStyle: s.style === "dashed" ? LineStyle.Dashed : s.style === "dotted" ? LineStyle.Dotted : LineStyle.Solid,
        priceFormat: { type: "custom", formatter: (v: number) => `${(v - 100).toFixed(1)}%` },
      })
      const seen = new Set<string>()
      line.setData(s.data.filter(d => !seen.has(d.time) && seen.add(d.time)).map(d => ({ time: d.time as Time, value: d.value })))
    }
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [series, resolved])
  return <div ref={ref} style={{ height }} className="w-full" />
}

export function SeriesLegend({ series }: { series: Pick<LineSeriesSpec, "name" | "tokenName" | "style">[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
      {series.map(s => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className="w-4" style={{ borderTop: `2px ${s.style ?? "solid"} var(--${s.tokenName})` }} />{s.name}
        </span>
      ))}
    </div>
  )
}
