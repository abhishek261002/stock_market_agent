// =============================================================================
// App shell + routes (pages are code-split)
// =============================================================================

import { MotionConfig } from "motion/react"
import { lazy, Suspense, useEffect } from "react"
import { Link, Route, Routes, useLocation } from "react-router-dom"
import { CommandPalette } from "./components/CommandPalette"
import { MobileNav, TopBar } from "./components/layout"
import { Skeleton } from "./components/ui"
import { AppDataProvider, useAppData } from "./lib/appData"
import { ThemeProvider } from "./lib/theme"

const Dashboard = lazy(() => import("./pages/Dashboard"))
const StockPage = lazy(() => import("./pages/StockPage"))
const Screener = lazy(() => import("./pages/Screener"))
const Compare = lazy(() => import("./pages/Compare"))
const Backtest = lazy(() => import("./pages/Backtest"))
const Watchlist = lazy(() => import("./pages/Watchlist"))
const HistoryPage = lazy(() => import("./pages/History"))

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  )
}

function Banner() {
  const { config, marketError, market } = useAppData()
  if (!config && marketError && !market) {
    return (
      <p role="alert" className="border-b border-down/40 bg-down-soft px-4 py-2 text-center text-xs text-fg md:px-6">
        The API is not reachable. Start the backend with <code className="num">uvicorn api.main:app --port 8000</code>.
      </p>
    )
  }
  if (config?.models?.demo) {
    return (
      <p className="border-b border-line bg-accent-soft px-4 py-2 text-center text-xs text-fg md:px-6">
        Demo mode: AI responses are simulated. Market data is live.
      </p>
    )
  }
  return null
}

function NotFound() {
  return (
    <div className="py-24">
      <p className="num text-sm text-fg-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold">This page does not exist</h1>
      <p className="mt-2 text-[13px] text-fg-2">The link may be old, or the ticker was mistyped.</p>
      <Link to="/" className="btn-secondary mt-6">Back to markets</Link>
    </div>
  )
}

function Shell() {
  const location = useLocation()
  useEffect(() => { window.scrollTo({ top: 0 }) }, [location.pathname])
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg text-fg">
      <TopBar />
      <Banner />
      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-24 pt-6 md:px-6 lg:pb-12">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/stock/:symbol" element={<StockPage />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1440px] px-4 py-5 text-xs leading-relaxed text-fg-3 md:px-6">
          AI-generated research for education only. It is not investment advice and not a recommendation by a
          SEBI-registered research analyst. Market data from Yahoo Finance and news from Google News, both may be delayed.
        </div>
      </footer>
      <MobileNav />
      <CommandPalette />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <AppDataProvider>
          <Shell />
        </AppDataProvider>
      </MotionConfig>
    </ThemeProvider>
  )
}
