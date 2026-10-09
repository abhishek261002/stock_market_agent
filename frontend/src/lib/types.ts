// =============================================================================
// src/lib/types.ts — DTOs mirroring the FastAPI responses
// =============================================================================

export type Action = "BUY" | "HOLD" | "SELL"
export type Stance = "bullish" | "neutral" | "bearish"
export type StageId = "fetch_data" | "fundamentals" | "technical" | "news" | "bull" | "bear" | "judge" | "risk"
export type StageStatus = "idle" | "running" | "done" | "error"

export interface StockData {
  symbol: string
  name: string
  sector: string
  industry: string
  exchange: string
  summary?: string
  website?: string | null
  current_price: number
  previous_close?: number
  change_1d_pct: number | null
  price_change_1m_pct: number | null
  week_52_high: number | null
  week_52_low: number | null
  pct_from_52w_high: number | null
  pct_from_52w_low: number | null
  pe_ratio: number | null
  forward_pe: number | null
  peg_ratio: number | null
  price_to_book: number | null
  ev_to_ebitda: number | null
  eps_ttm: number | null
  revenue_growth: number | null
  earnings_growth: number | null
  profit_margin: number | null
  operating_margin: number | null
  market_cap: number | null
  debt_to_equity: number | null
  return_on_equity: number | null
  return_on_assets: number | null
  current_ratio: number | null
  dividend_yield: number | null
  beta: number | null
  insider_holding_pct: number | null
  institution_holding_pct: number | null
  latest_volume: number
  avg_volume_20d: number
  volume_ratio: number | null
  analyst_recommendation: string
  analyst_count: number | null
  target_price: number | null
  target_high: number | null
  target_low: number | null
  target_upside_pct: number | null
  tech_rsi_14: number | null
  tech_sma_20: number | null
  tech_sma_50: number | null
  tech_sma_200: number | null
  tech_macd: number | null
  tech_macd_signal: number | null
  tech_macd_state: "bullish" | "bearish" | null
  tech_bb_position_pct: number | null
  tech_atr_14: number | null
  tech_atr_pct: number | null
  tech_volatility_ann: number | null
  tech_max_drawdown_1y: number | null
  tech_change_1w_pct: number | null
  tech_change_1m_pct: number | null
  tech_change_3m_pct: number | null
  tech_change_6m_pct: number | null
  tech_change_1y_pct: number | null
  tech_rel_strength_3m: number | null
  tech_trend: string
  financial_currency: string
  fetched_at: string
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  sma20: number | null
  sma50: number | null
  sma200: number | null
  rsi: number | null
  macd_hist: number | null
}

export interface QuarterRow {
  period: string
  revenue: number | null
  net_income: number | null
  operating_income: number | null
  eps: number | null
  net_margin_pct: number | null
  op_margin_pct: number | null
}

export interface PeerRow {
  symbol: string
  name: string
  sector: string | null
  price: number
  change_1d_pct: number | null
  change_1y_pct: number | null
  market_cap: number | null
  pe_ratio: number | null
  price_to_book: number | null
  return_on_equity: number | null
  revenue_growth: number | null
  profit_margin: number | null
  debt_to_equity: number | null
  dividend_yield: number | null
  sparkline: number[]
}

export interface AnalysisSummary {
  id: string
  symbol: string
  name: string | null
  created_at: string
  verdict: Action | null
  confidence: number | null
  price: number | null
  rounds: number | null
  bull_conf: number | null
  bear_conf: number | null
}

export interface StockDetail {
  data: StockData
  chart: { candles: Candle[] }
  financials: QuarterRow[]
  peers: PeerRow[]
  in_watchlist: boolean
  history: AnalysisSummary[]
}

export interface Headline {
  title: string
  source: string
  published: string | null
  link: string | null
  sentiment?: "positive" | "neutral" | "negative"
  impact?: "high" | "medium" | "low"
}

export interface AnalystReport {
  stance: Stance
  score: number
  headline: string
  summary: string
  key_points: string[]
  red_flags: string[]
  failed?: boolean
  // news analyst extras
  sentiment_score?: number
  themes?: string[]
  headlines?: Headline[]
  searches?: string[]
  research_reason?: string
}

export interface DebatePoint { title: string; detail: string }
export interface DebateArgument {
  thesis: string
  points: DebatePoint[]
  rebuttal: string | null
  concession: string | null
  confidence: number
}
export interface DebateEntry { side: "bull" | "bear"; round: number; argument: DebateArgument }

export interface Verdict {
  verdict: Action
  confidence: number
  time_horizon: string
  headline: string
  bull_assessment: string
  bear_assessment: string
  reasoning: string
  decisive_factors: string[]
  key_risks: string[]
  catalysts: string[]
  suggested_action: string
  winner: "bull" | "bear" | "draw"
}

export interface RiskPlan {
  action: Action
  entry: number
  stop_loss: number
  stop_distance_pct: number
  target_1: number
  target_2: number
  risk_reward: number | null
  position_size_pct: number
  volatility_regime: string
  atr: number
  nearest_support: number | null
  nearest_resistance: number | null
  analyst_target: number | null
  method: string
  notes: string[]
  invalidation: string
}

export interface AnalysisResult {
  id: string
  symbol: string
  created_at: string
  rounds: number
  stock_data: StockData
  financials: QuarterRow[]
  peers: PeerRow[]
  analyst_reports: Partial<Record<"fundamentals" | "technical" | "news", AnalystReport>>
  debate: DebateEntry[]
  verdict: Verdict
  risk_plan: RiskPlan | null
  warnings: string[]
  previous: AnalysisSummary | null
  duration_sec: number
  disclaimer: string
}

export interface PipelineEvent {
  type: "stage" | "throttle" | "debate_start" | "round_end" | "complete" | "error" | "progress" | "token"
  stage?: StageId
  status?: StageStatus
  payload?: unknown
  round?: number
  elapsed?: number
  wait?: number
  message?: string
  result?: unknown
  max_rounds?: number
  bull_confidence?: number
  bear_confidence?: number
  text?: string
  [k: string]: unknown
}

export interface IndexQuote {
  symbol: string
  name: string
  price: number
  change: number
  change_pct: number
  change_1m_pct: number
  sparkline: number[]
}

export interface MarketOverview {
  status: { open: boolean; label: string; time_ist: string }
  indices: IndexQuote[]
  gainers: (IndexQuote & { sector: string })[]
  losers: (IndexQuote & { sector: string })[]
  sectors: {
    sector: string
    change_pct: number
    change_1m_pct: number
    count: number
    stocks: { symbol: string; name: string; change_pct: number; price: number }[]
  }[]
  breadth: { advancers: number; decliners: number; unchanged: number; total: number }
  tape: { symbol: string; price: number; change_pct: number }[]
  updated_at: string
}

export interface ScreenerRow {
  symbol: string
  name: string
  sector: string
  price: number
  change_1d_pct: number | null
  change_1w_pct: number | null
  change_1m_pct: number | null
  change_3m_pct: number | null
  change_1y_pct: number | null
  rsi_14: number | null
  above_sma200: boolean | null
  pct_from_52w_high: number | null
  volatility_ann: number | null
  rel_strength_3m: number | null
  volume_ratio: number | null
  sparkline: number[]
  market_cap?: number | null
  pe_ratio?: number | null
  forward_pe?: number | null
  price_to_book?: number | null
  return_on_equity?: number | null
  revenue_growth?: number | null
  earnings_growth?: number | null
  profit_margin?: number | null
  debt_to_equity?: number | null
  dividend_yield?: number | null
  beta?: number | null
  analyst_rating?: string | null
  target_upside_pct?: number | null
  quality_score: number
  value_score: number
  momentum_score: number
  overall_score: number
}

export interface ScreenerFilters {
  sectors: string[]
  pe_max?: number | null
  pe_min?: number | null
  pb_max?: number | null
  roe_min?: number | null
  de_max?: number | null
  revenue_growth_min?: number | null
  profit_margin_min?: number | null
  dividend_yield_min?: number | null
  market_cap_min_cr?: number | null
  rsi_min?: number | null
  rsi_max?: number | null
  change_1m_min?: number | null
  change_1m_max?: number | null
  change_1y_min?: number | null
  above_sma200?: boolean | null
  near_52w_high_pct?: number | null
  sort_by: keyof ScreenerRow
  sort_desc: boolean
  explanation?: string
}

export interface Preset {
  id: string
  label: string
  icon: string
  description: string
  filters: Partial<ScreenerFilters>
}

export interface RankedPick { symbol: string; rank: number; score: number; thesis: string; risk: string }

export interface CompareResult {
  symbols: string[]
  stocks: (Partial<StockData> & { symbol: string; name: string; sector: string })[]
  performance: Record<string, { time: string; value: number }[]>
  verdict: {
    winner: string
    headline: string
    reasoning: string
    entries: { symbol: string; score: number; strengths: string[]; weaknesses: string[]; best_for: string }[]
  }
}

export interface BacktestRow {
  date: string
  exit_date: string
  price: number
  exit_price: number
  fwd_return_pct: number
  bench_return_pct: number
  excess_pct: number
  rule_call: Action
  ai_call: Action
  ai_confidence: number
  ai_rationale: string
  ai_correct: boolean
  rule_correct: boolean
  rsi: number | null
  trend: string
}

export interface BacktestResult {
  id: string
  symbol: string
  created_at: string
  horizon_days: number
  rows: BacktestRow[]
  equity: { date: string; ai: number; rule: number; buy_hold: number; nifty: number }[]
  metrics: {
    points: number
    ai_hit_rate: number
    rule_hit_rate: number
    ai_total_return: number
    rule_total_return: number
    buy_hold_return: number
    nifty_return: number
    avg_excess_on_buy: number | null
    avg_excess_on_sell: number | null
    calls: Record<Action, number>
  }
  caveats: string[]
}

export interface WatchItem {
  symbol: string
  name: string | null
  added_at: string
  price: number | null
  change_since_analysis_pct?: number
  last_analysis: AnalysisSummary | null
}

export interface Alert {
  id: number
  symbol: string
  kind: "verdict_flip" | "price" | "info"
  title: string
  message: string
  created_at: string
  read: number
}

export interface PriceAlert {
  id: number
  symbol: string
  direction: "above" | "below"
  price: number
  created_at: string
  triggered_at: string | null
}

export interface SearchResult { symbol: string; name: string; sector: string | null }
