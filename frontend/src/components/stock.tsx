// =============================================================================
// Stock page building blocks
// =============================================================================

import { motion } from "motion/react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { compact, crore, cx, inr, isNum, NA, num, pct, ticker, upDown } from "../lib/format"
import type { PeerRow, QuarterRow, StockData } from "../lib/types"
import { Change, Segmented, Sparkline, Stat } from "./ui"

export function KeyStats({ d }: { d: StockData }) {
  const items: [string, string, string?][] = [
    ["Market cap", crore(d.market_cap)],
    ["P/E", num(d.pe_ratio, 1), d.forward_pe ? `${num(d.forward_pe, 1)} forward` : undefined],
    ["P/B", num(d.price_to_book, 2)],
    ["ROE", pct(d.return_on_equity, { sign: false, decimals: 1 })],
    ["Net margin", pct(d.profit_margin, { sign: false, decimals: 1 })],
    ["Revenue growth", pct(d.revenue_growth, { decimals: 1 }), "year on year"],
    ["Debt to equity", num(d.debt_to_equity, 2, "x")],
    ["Dividend yield", pct(d.dividend_yield, { sign: false })],
    ["EPS", inr(d.eps_ttm), "trailing 12m"],
    ["Beta", num(d.beta, 2)],
    ["Volume", compact(d.latest_volume), `${num(d.volume_ratio, 2)}x 20-day avg`],
    ["Volatility", pct(d.tech_volatility_ann, { sign: false, decimals: 1 }), "annualised"],
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {items.map(([l, v, s]) => <Stat key={l} label={l} value={v} sub={s} />)}
    </dl>
  )
}

export function RangeBar({ low, high, value, label, marker }: {
  low: number | null; high: number | null; value: number; label: string; marker?: { value: number | null; label: string }
}) {
  if (!isNum(low) || !isNum(high) || high <= low) return null
  const p = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100))
  const m = marker && isNum(marker.value) ? Math.max(0, Math.min(100, ((marker.value - low) / (high - low)) * 100)) : null
  return (
    <div>
      <p className="label mb-2.5">{label}</p>
      <div className="relative h-1 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 rounded-full bg-fg-3" style={{ width: `${p}%` }} />
        <motion.span className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
          initial={{ left: "0%" }} animate={{ left: `${p}%` }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
        {m !== null && <span className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${m}%` }} />}
      </div>
      <div className="num mt-2 flex justify-between gap-2 text-[11px] text-fg-3">
        <span>{inr(low)}</span>
        {m !== null && <span className="text-accent">{marker!.label} {inr(marker!.value)}</span>}
        <span>{inr(high)}</span>
      </div>
    </div>
  )
}

export function TechSnapshot({ d }: { d: StockData }) {
  const rsi = d.tech_rsi_14
  const zone = !isNum(rsi) ? NA : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral"
  const trend = d.tech_trend ?? NA
  const rows: [string, React.ReactNode][] = [
    ["Trend", <span key="t" className={cx(trend.includes("uptrend") ? "text-up" : trend.includes("downtrend") ? "text-down" : "text-fg")}>{trend.replace(/^./, s => s.toUpperCase())}</span>],
    ["RSI (14)", <span key="r">{num(rsi, 1)} <span className="text-fg-3">{zone}</span></span>],
    ["MACD", <span key="m" className={d.tech_macd_state === "bullish" ? "text-up" : d.tech_macd_state === "bearish" ? "text-down" : ""}>{d.tech_macd_state ? d.tech_macd_state.replace(/^./, s => s.toUpperCase()) : NA}</span>],
    ["vs 50-day avg", <Change key="50" value={isNum(d.tech_sma_50) ? (d.current_price / d.tech_sma_50 - 1) * 100 : null} />],
    ["vs 200-day avg", <Change key="200" value={isNum(d.tech_sma_200) ? (d.current_price / d.tech_sma_200 - 1) * 100 : null} />],
    ["vs Nifty, 3 months", <span key="rs" className={upDown(d.tech_rel_strength_3m)}>{isNum(d.tech_rel_strength_3m) ? `${d.tech_rel_strength_3m > 0 ? "+" : ""}${d.tech_rel_strength_3m.toFixed(1)} pts` : NA}</span>],
    ["Max drawdown, 1Y", <span key="dd">{pct(d.tech_max_drawdown_1y)}</span>],
  ]
  return (
    <dl className="divide-y divide-line">
      {rows.map(([l, v]) => (
        <div key={l} className="flex items-center justify-between gap-4 py-2 text-[13px]">
          <dt className="text-fg-3">{l}</dt><dd className="num text-right text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Returns({ d }: { d: StockData }) {
  const items: [string, number | null][] = [
    ["1D", d.change_1d_pct], ["1W", d.tech_change_1w_pct], ["1M", d.tech_change_1m_pct],
    ["3M", d.tech_change_3m_pct], ["6M", d.tech_change_6m_pct], ["1Y", d.tech_change_1y_pct],
  ]
  return (
    <dl className="grid grid-cols-6 gap-2">
      {items.map(([l, v]) => (
        <div key={l}>
          <dt className="text-[11px] text-fg-3">{l}</dt>
          <dd className={cx("num mt-0.5 text-[13px]", upDown(v))}>{pct(v, { decimals: 1 })}</dd>
        </div>
      ))}
    </dl>
  )
}

export function FinancialBars({ rows, currency }: { rows: QuarterRow[]; currency: string }) {
  const [metric, setMetric] = useState<"revenue" | "net_income" | "operating_income">("revenue")
  if (rows.length === 0) return <p className="px-5 pb-6 text-[13px] text-fg-2">Quarterly results are not available for this company.</p>
  const div = currency === "INR" ? 1e7 : 1e6
  const unit = currency === "INR" ? "₹ crore" : `${currency} million`
  const vals = rows.map(r => r[metric] ?? 0)
  const max = Math.max(...vals.map(Math.abs), 1)
  return (
    <div className="px-5 pb-5">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented label="Metric" value={metric} onChange={setMetric} options={[
          { id: "revenue", label: "Revenue" }, { id: "operating_income", label: "Operating profit" }, { id: "net_income", label: "Net profit" },
        ]} />
        <span className="text-xs text-fg-3">{unit}{currency !== "INR" ? `, as reported by the company` : ""}</span>
      </div>
      <div className="grid h-52 items-end gap-3" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((r, i) => {
          const v = r[metric] ?? 0
          const prev = i > 0 ? rows[i - 1][metric] ?? null : null
          const growth = prev ? ((v - prev) / Math.abs(prev)) * 100 : null
          const latest = i === rows.length - 1
          return (
            <div key={r.period} className="flex h-full flex-col justify-end gap-1.5">
              <span className="num text-center text-[11px] text-fg-2">{compact(v / div)}</span>
              <motion.div key={metric} className={cx("mx-auto w-full max-w-12 origin-bottom rounded-t-[3px]",
                v < 0 ? "bg-down" : latest ? "bg-accent" : "bg-fg-3/60")}
                style={{ height: `${Math.max(2, (Math.abs(v) / max) * 78)}%` }}
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.5, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }} />
              <span className="num text-center text-[11px] text-fg-3">{r.period}</span>
              <span className={cx("num h-4 text-center text-[11px]", upDown(growth))}>{growth !== null ? pct(growth, { decimals: 0 }) : ""}</span>
            </div>
          )
        })}
      </div>
      <table className="mt-5 w-full text-[13px]">
        <thead><tr className="text-left text-xs text-fg-3"><th className="py-2 font-normal">Quarter</th><th className="py-2 text-right font-normal">Net margin</th><th className="py-2 text-right font-normal">Operating margin</th></tr></thead>
        <tbody>
          {rows.slice(-4).map(r => (
            <tr key={r.period} className="border-t border-line">
              <td className="num py-2 text-fg-2">{r.period}</td>
              <td className="num py-2 text-right">{pct(r.net_margin_pct, { sign: false, decimals: 1 })}</td>
              <td className="num py-2 text-right">{pct(r.op_margin_pct, { sign: false, decimals: 1 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PeersTable({ peers, self }: { peers: PeerRow[]; self?: StockData }) {
  const navigate = useNavigate()
  if (peers.length === 0) return <p className="px-5 pb-6 text-[13px] text-fg-2">No sector peers in the covered universe.</p>
  const rows: (PeerRow & { self?: boolean })[] = [
    ...(self ? [{
      symbol: self.symbol, name: self.name, sector: self.sector, price: self.current_price, change_1d_pct: self.change_1d_pct,
      change_1y_pct: self.tech_change_1y_pct, market_cap: self.market_cap, pe_ratio: self.pe_ratio, price_to_book: self.price_to_book,
      return_on_equity: self.return_on_equity, revenue_growth: self.revenue_growth, profit_margin: self.profit_margin,
      debt_to_equity: self.debt_to_equity, dividend_yield: self.dividend_yield, sparkline: [], self: true,
    }] : []),
    ...peers,
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px] [&_td]:whitespace-nowrap">
        <thead>
          <tr className="border-b border-line text-xs text-fg-3">
            <th className="px-5 py-2 text-left font-normal">Company</th>
            <th className="px-3 py-2 text-right font-normal">Price</th>
            <th className="px-3 py-2 text-right font-normal">1D</th>
            <th className="px-3 py-2 text-right font-normal">1Y</th>
            <th className="px-3 py-2 text-right font-normal">Market cap</th>
            <th className="px-3 py-2 text-right font-normal">P/E</th>
            <th className="px-3 py-2 text-right font-normal">ROE</th>
            <th className="px-3 py-2 text-right font-normal">Net margin</th>
            <th className="px-3 py-2 text-right font-normal">D/E</th>
            <th className="px-5 py-2 text-right font-normal">60 days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.symbol} onClick={() => !p.self && navigate(`/stock/${encodeURIComponent(p.symbol)}`)}
              className={cx("row", p.self ? "bg-surface-2" : "cursor-pointer")}>
              <td className="px-5 py-2.5">
                <span className="num text-fg">{ticker(p.symbol)}</span>
                <span className="ml-2 text-xs text-fg-3">{p.self ? "this stock" : p.name}</span>
              </td>
              <td className="num px-3 py-2.5 text-right">{inr(p.price)}</td>
              <td className="px-3 py-2.5 text-right"><Change value={p.change_1d_pct} /></td>
              <td className="px-3 py-2.5 text-right"><Change value={p.change_1y_pct} decimals={1} /></td>
              <td className="num px-3 py-2.5 text-right text-fg-2">{crore(p.market_cap)}</td>
              <td className="num px-3 py-2.5 text-right">{num(p.pe_ratio, 1)}</td>
              <td className="num px-3 py-2.5 text-right">{pct(p.return_on_equity, { sign: false, decimals: 1 })}</td>
              <td className="num px-3 py-2.5 text-right">{pct(p.profit_margin, { sign: false, decimals: 1 })}</td>
              <td className="num px-3 py-2.5 text-right">{num(p.debt_to_equity, 2)}</td>
              <td className="px-5 py-2.5"><div className="flex justify-end">{p.sparkline.length > 1 && <Sparkline data={p.sparkline} width={80} height={22} />}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
