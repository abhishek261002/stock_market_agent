import { useState, useCallback, useEffect, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AgentEvent {
  stage: "fetch_data" | "bull" | "bear" | "judge" | "complete" | "error";
  status: "running" | "done" | "error";
  data: string;
}
type StageStatus = "idle" | "running" | "done" | "error";
interface PipelineStage {
  id: AgentEvent["stage"];
  label: string;
  icon: string;
  status: StageStatus;
  content: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const INITIAL_STAGES: PipelineStage[] = [
  { id: "fetch_data", label: "Data Fetcher",  icon: "📡", status: "idle", content: "" },
  { id: "bull",       label: "Bull Agent",    icon: "🐂", status: "idle", content: "" },
  { id: "bear",       label: "Bear Agent",    icon: "🐻", status: "idle", content: "" },
  { id: "judge",      label: "Judge Agent",   icon: "⚖️",  status: "idle", content: "" },
];

const POPULAR = ["INFY.NS","RELIANCE.NS","TCS.NS","HDFCBANK.NS","ZOMATO.BO","TATAMOTORS.NS"];

// ─── Hook ─────────────────────────────────────────────────────────────────────
function useStockAnalysis() {
  const [stages, setStages]       = useState<PipelineStage[]>(INITIAL_STAGES);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const updateStage = useCallback((id: string, updates: Partial<PipelineStage>) => {
    setStages(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const analyse = useCallback(async (symbol: string) => {
    setStages(INITIAL_STAGES);
    setError(null);
    setIsRunning(true);
    try {
      const response = await fetch("http://localhost:8000/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!response.ok) throw new Error(`API error: ${response.statusText}`);

      const reader  = response.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));
            if (event.stage === "complete") continue;
            if (event.stage === "error") { setError(event.data); continue; }
            updateStage(event.stage, {
              status:  event.status === "running" ? "running" : event.status === "done" ? "done" : "error",
              content: event.status === "done" ? event.data : "",
            });
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsRunning(false);
    }
  }, [updateStage]);

  return { stages, isRunning, error, analyse };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractScore(text: string, keyword: string): number | null {
  const re = new RegExp(`${keyword}[^\\d]*(\\d+(?:\\.\\d+)?)\\/10`, "i");
  const m  = text.match(re);
  return m ? parseFloat(m[1]) : null;
}

function extractVerdict(text: string): "BUY" | "HOLD" | "SELL" | null {
  const m = text.match(/Verdict\s*:\s*(BUY|HOLD|SELL)/i);
  return m ? (m[1].toUpperCase() as any) : null;
}

function extractConfidence(text: string): number | null {
  const m = text.match(/Confidence\s*:\s*(\d+(?:\.\d+)?)\/10/i);
  return m ? parseFloat(m[1]) : null;
}

// ─── Mini animated bar ────────────────────────────────────────────────────────
function ScoreBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => { setTimeout(() => setWidth((value / max) * 100), 100); }, [value, max]);
  return (
    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-1000 ease-out ${color}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// ─── Debate Meter (tug-of-war) ────────────────────────────────────────────────
function DebateMeter({ bullScore, bearScore }: { bullScore: number | null; bearScore: number | null }) {
  if (!bullScore && !bearScore) return null;
  const b = bullScore ?? 0;
  const r = bearScore ?? 0;
  const total = b + r || 1;
  const bullPct = (b / total) * 100;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      <div className="flex justify-between items-center mb-3">
        <span className="text-amber-400 font-bold text-sm flex items-center gap-1">🐂 Bull {b}/10</span>
        <span className="text-white/40 text-xs font-mono">DEBATE METER</span>
        <span className="text-rose-400 font-bold text-sm flex items-center gap-1">{r}/10 Bear 🐻</span>
      </div>
      <div className="h-4 rounded-full bg-rose-500/30 overflow-hidden relative">
        <div
          className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${bullPct}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white/80 tracking-widest">VS</span>
        </div>
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-amber-400/60">Bullish</span>
        <span className="text-[10px] text-rose-400/60">Bearish</span>
      </div>
    </div>
  );
}

// ─── Radial confidence gauge ──────────────────────────────────────────────────
function ConfidenceGauge({ value, verdict }: { value: number; verdict: string | null }) {
  const pct    = value / 10;
  const r      = 54;
  const circ   = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const color  = verdict === "BUY" ? "#10B981" : verdict === "SELL" ? "#EF4444" : "#F59E0B";

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12"/>
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={color} strokeWidth="12"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
        <text x="70" y="62" textAnchor="middle" fill="white" fontSize="22" fontWeight="800"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</text>
        <text x="70" y="78" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">/10 confidence</text>
        {verdict && (
          <text x="70" y="98" textAnchor="middle" fill={color} fontSize="13" fontWeight="700"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{verdict}</text>
        )}
      </svg>
    </div>
  );
}

// ─── Pipeline progress rail ───────────────────────────────────────────────────
function PipelineRail({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="flex flex-col gap-0">
      {stages.map((stage, i) => {
        const isDone    = stage.status === "done";
        const isRunning = stage.status === "running";
        const isIdle    = stage.status === "idle";
        return (
          <div key={stage.id} className="flex items-start gap-3">
            {/* Node + connector */}
            <div className="flex flex-col items-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base border-2 transition-all duration-500
                ${isDone    ? "border-emerald-400 bg-emerald-400/20"  : ""}
                ${isRunning ? "border-blue-400   bg-blue-400/20 animate-pulse" : ""}
                ${isIdle    ? "border-white/20   bg-white/5"    : ""}
                ${stage.status === "error" ? "border-red-400 bg-red-400/20" : ""}
              `}>
                {isDone ? "✓" : stage.icon}
              </div>
              {i < stages.length - 1 && (
                <div className={`w-0.5 h-8 mt-1 transition-all duration-700
                  ${isDone ? "bg-emerald-400/60" : "bg-white/10"}`}
                />
              )}
            </div>
            {/* Label */}
            <div className="pt-1.5 pb-8">
              <p className={`text-sm font-semibold transition-colors duration-300
                ${isDone    ? "text-emerald-400" : ""}
                ${isRunning ? "text-blue-400"    : ""}
                ${isIdle    ? "text-white/30"    : ""}
              `}>{stage.label}</p>
              {isRunning && (
                <p className="text-xs text-blue-400/60 mt-0.5 animate-pulse">Thinking...</p>
              )}
              {isDone && (
                <p className="text-xs text-emerald-400/60 mt-0.5">Complete</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Typing text effect ───────────────────────────────────────────────────────
function TypingText({ text, speed = 6 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const idx = useRef(0);

  useEffect(() => {
    setDisplayed("");
    idx.current = 0;
    if (!text) return;
    const interval = setInterval(() => {
      idx.current += speed;
      setDisplayed(text.slice(0, idx.current));
      if (idx.current >= text.length) clearInterval(interval);
    }, 16);
    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <p className="text-sm leading-relaxed text-white/75 whitespace-pre-wrap font-mono">
      {displayed}
      {displayed.length < text.length && (
        <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
      )}
    </p>
  );
}

// ─── Agent debate cards ───────────────────────────────────────────────────────
function BullCard({ stage }: { stage: PipelineStage }) {
  const score = stage.content ? extractScore(stage.content, "Bull Confidence") : null;
  return (
    <div className={`rounded-2xl border overflow-hidden transition-all duration-500
      ${stage.status === "done"    ? "border-amber-500/40 bg-amber-500/5"  : ""}
      ${stage.status === "running" ? "border-blue-400/40  bg-blue-400/5"   : ""}
      ${stage.status === "idle"    ? "border-white/10     bg-white/3"       : ""}
    `}>
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
        <span className="text-2xl">🐂</span>
        <div>
          <p className="font-bold text-amber-400" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Bull Case</p>
          <p className="text-xs text-white/40">Bullish argument</p>
        </div>
        {score && (
          <div className="ml-auto text-right">
            <p className="text-2xl font-black text-amber-400">{score}<span className="text-sm text-white/30">/10</span></p>
            <ScoreBar value={score} color="bg-amber-400" />
          </div>
        )}
        {stage.status === "running" && (
          <div className="ml-auto flex gap-1">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
                style={{ animationDelay: `${i*150}ms` }} />
            ))}
          </div>
        )}
      </div>
      {stage.content && (
        <div className="px-5 py-4">
          <TypingText text={stage.content} />
        </div>
      )}
      {stage.status === "idle" && (
        <div className="px-5 py-8 text-center text-white/20 text-sm">
          Waiting for data...
        </div>
      )}
    </div>
  );
}

function BearCard({ stage }: { stage: PipelineStage }) {
  const score = stage.content ? extractScore(stage.content, "Bear Confidence") : null;
  return (
    <div className={`rounded-2xl border overflow-hidden transition-all duration-500
      ${stage.status === "done"    ? "border-rose-500/40  bg-rose-500/5"   : ""}
      ${stage.status === "running" ? "border-blue-400/40  bg-blue-400/5"   : ""}
      ${stage.status === "idle"    ? "border-white/10     bg-white/3"       : ""}
    `}>
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
        <span className="text-2xl">🐻</span>
        <div>
          <p className="font-bold text-rose-400" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Bear Case</p>
          <p className="text-xs text-white/40">Bearish argument</p>
        </div>
        {score && (
          <div className="ml-auto text-right">
            <p className="text-2xl font-black text-rose-400">{score}<span className="text-sm text-white/30">/10</span></p>
            <ScoreBar value={score} color="bg-rose-400" />
          </div>
        )}
        {stage.status === "running" && (
          <div className="ml-auto flex gap-1">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
                style={{ animationDelay: `${i*150}ms` }} />
            ))}
          </div>
        )}
      </div>
      {stage.content && (
        <div className="px-5 py-4">
          <TypingText text={stage.content} />
        </div>
      )}
      {stage.status === "idle" && (
        <div className="px-5 py-8 text-center text-white/20 text-sm">
          Waiting for data...
        </div>
      )}
    </div>
  );
}

function JudgeCard({ stage }: { stage: PipelineStage }) {
  const verdict    = stage.content ? extractVerdict(stage.content) : null;
  const confidence = stage.content ? extractConfidence(stage.content) : null;

  const verdictStyle = {
    BUY:  { text: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/40", glow: "shadow-emerald-400/20" },
    HOLD: { text: "text-amber-400",   bg: "bg-amber-400/10   border-amber-400/40",   glow: "shadow-amber-400/20"  },
    SELL: { text: "text-rose-400",    bg: "bg-rose-400/10    border-rose-400/40",     glow: "shadow-rose-400/20"   },
  }[verdict ?? ""] ?? { text: "text-white", bg: "bg-white/5 border-white/20", glow: "" };

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all duration-500
      ${stage.status === "done"    ? `border-purple-500/40 bg-purple-500/5` : ""}
      ${stage.status === "running" ? "border-blue-400/40   bg-blue-400/5"   : ""}
      ${stage.status === "idle"    ? "border-white/10      bg-white/3"      : ""}
    `}>
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
        <span className="text-2xl">⚖️</span>
        <div>
          <p className="font-bold text-purple-400" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Judge Verdict</p>
          <p className="text-xs text-white/40">Final decision</p>
        </div>
        {stage.status === "running" && (
          <div className="ml-auto flex gap-1">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
                style={{ animationDelay: `${i*150}ms` }} />
            ))}
          </div>
        )}
      </div>

      {/* Verdict hero section */}
      {verdict && confidence && (
        <div className="px-5 pt-5 pb-2 flex items-center gap-8 flex-wrap">
          <ConfidenceGauge value={confidence} verdict={verdict} />
          <div className="flex-1 min-w-[180px] space-y-3">
            <div className={`inline-block px-6 py-2 rounded-xl border text-3xl font-black shadow-lg ${verdictStyle.bg} ${verdictStyle.text} ${verdictStyle.glow}`}
              style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
              {verdict}
            </div>
            <p className="text-sm text-white/50">
              {verdict === "BUY"  && "Agents lean bullish — upside outweighs risks"}
              {verdict === "HOLD" && "Arguments balanced — monitor before committing"}
              {verdict === "SELL" && "Agents lean bearish — risks outweigh upside"}
            </p>
            {/* Confidence bar */}
            <div>
              <div className="flex justify-between text-xs text-white/40 mb-1">
                <span>Confidence</span>
                <span>{confidence}/10</span>
              </div>
              <ScoreBar value={confidence} color={
                verdict === "BUY"  ? "bg-gradient-to-r from-emerald-500 to-emerald-400" :
                verdict === "SELL" ? "bg-gradient-to-r from-rose-500    to-rose-400"    :
                                     "bg-gradient-to-r from-amber-500   to-amber-400"
              } />
            </div>
          </div>
        </div>
      )}

      {stage.content && (
        <div className="px-5 py-4">
          <TypingText text={stage.content} speed={10} />
        </div>
      )}

      {stage.status === "idle" && (
        <div className="px-5 py-8 text-center text-white/20 text-sm">
          Waiting for Bull & Bear to finish...
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
      <div className="relative">
        <div className="text-7xl opacity-80 select-none">🐂</div>
        <div className="absolute -right-8 -top-2 text-5xl opacity-80 select-none">⚖️</div>
        <div className="absolute -right-16 top-6 text-7xl opacity-80 select-none">🐻</div>
      </div>
      <div className="mt-6">
        <p className="text-2xl font-bold text-white/80" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
          Let the debate begin
        </p>
        <p className="text-white/40 text-sm mt-2 max-w-xs">
          Enter any NSE or BSE symbol. Two AI agents will argue the stock — a Judge will decide.
        </p>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [symbol, setSymbol] = useState("INFY.NS");
  const { stages, isRunning, error, analyse } = useStockAnalysis();

  const bullStage  = stages.find(s => s.id === "bull")!;
  const bearStage  = stages.find(s => s.id === "bear")!;
  const judgeStage = stages.find(s => s.id === "judge")!;
  const fetchStage = stages.find(s => s.id === "fetch_data")!;

  const bullScore = bullStage.content  ? extractScore(bullStage.content,  "Bull Confidence") : null;
  const bearScore = bearStage.content  ? extractScore(bearStage.content,  "Bear Confidence") : null;
  const hasResults = stages.some(s => s.status !== "idle");

  const handleAnalyse = () => {
    if (!symbol.trim() || isRunning) return;
    analyse(symbol.trim().toUpperCase());
  };

  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700;800&display=swap');
        * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
        body { margin: 0; background: #080D1A; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      <div className="min-h-screen text-white" style={{ background: "linear-gradient(135deg, #080D1A 0%, #0D1525 50%, #080D1A 100%)" }}>

        {/* ── Top nav ── */}
        <nav className="border-b border-white/8 backdrop-blur sticky top-0 z-50"
          style={{ background: "rgba(8,13,26,0.85)" }}>
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-lg">
                📈
              </div>
              <div>
                <p className="font-bold text-white leading-none" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
                  Stock Screener Agent
                </p>
                <p className="text-[11px] text-white/40 leading-none mt-0.5">
                  Bull vs Bear • LangGraph + GPT-4o-mini
                </p>
              </div>
            </div>

            {/* Search bar — in nav */}
            <div className="flex-1 max-w-xl mx-auto flex gap-2">
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleAnalyse()}
                placeholder="e.g. INFY.NS, RELIANCE.NS, TCS.NS"
                className="flex-1 bg-white/6 border border-white/10 rounded-xl px-4 py-2.5 text-sm
                           text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60
                           transition-colors font-mono"
              />
              <button
                onClick={handleAnalyse}
                disabled={isRunning || !symbol.trim()}
                className="px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                           disabled:opacity-40 disabled:cursor-not-allowed
                           bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400
                           shadow-lg shadow-blue-500/20"
              >
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
                    Analysing
                  </span>
                ) : "Analyse →"}
              </button>
            </div>

            {/* Quick picks */}
            <div className="hidden lg:flex items-center gap-1.5 flex-wrap">
              {POPULAR.map(s => (
                <button key={s} onClick={() => setSymbol(s)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10
                             text-white/50 hover:text-white/80 border border-white/8 transition-all font-mono">
                  {s}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* ── Main layout ── */}
        <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">

          {/* ── Left sidebar ── */}
          <aside className="w-56 shrink-0 hidden lg:block">
            <div className="sticky top-24 space-y-5">

              {/* Pipeline rail */}
              <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
                  Pipeline
                </p>
                <PipelineRail stages={stages} />
              </div>

              {/* Status card */}
              {hasResults && (
                <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-2">
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Status</p>
                  {fetchStage.status === "done" && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
                      <span className="text-xs text-white/60">Data ready</span>
                    </div>
                  )}
                  {isRunning && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"/>
                      <span className="text-xs text-blue-400/80">Agents running</span>
                    </div>
                  )}
                  {!isRunning && hasResults && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400"/>
                      <span className="text-xs text-white/60">Analysis done</span>
                    </div>
                  )}
                </div>
              )}

              {/* Debate meter */}
              <DebateMeter bullScore={bullScore} bearScore={bearScore} />
            </div>
          </aside>

          {/* ── Main content ── */}
          <main className="flex-1 min-w-0 space-y-4">

            {/* Error */}
            {error && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/8 px-5 py-4 flex items-start gap-3">
                <span className="text-rose-400 text-lg mt-0.5">⚠</span>
                <div>
                  <p className="text-sm font-semibold text-rose-400">Analysis failed</p>
                  <p className="text-xs text-rose-400/70 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!hasResults && !error && <EmptyState />}

            {/* Data fetcher banner */}
            {fetchStage.status !== "idle" && (
              <div className={`rounded-2xl border px-5 py-3 flex items-center gap-3 transition-all duration-500
                ${fetchStage.status === "done"    ? "border-blue-500/30 bg-blue-500/5"  : ""}
                ${fetchStage.status === "running" ? "border-blue-400/40 bg-blue-400/8 animate-pulse" : ""}
              `}>
                <span className="text-xl">📡</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white/80">Data Fetcher</p>
                  <p className="text-xs text-white/40">
                    {fetchStage.status === "running" ? `Fetching live NSE/BSE data for ${symbol}...` : fetchStage.content}
                  </p>
                </div>
                {fetchStage.status === "done" && (
                  <span className="text-xs text-emerald-400 font-semibold">✓ Ready</span>
                )}
                {fetchStage.status === "running" && (
                  <div className="flex gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                        style={{ animationDelay: `${i*120}ms` }} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bull + Bear side by side */}
            {(bullStage.status !== "idle" || bearStage.status !== "idle") && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <BullCard stage={bullStage} />
                <BearCard stage={bearStage} />
              </div>
            )}

            {/* Judge verdict */}
            {judgeStage.status !== "idle" && (
              <JudgeCard stage={judgeStage} />
            )}

          </main>
        </div>
      </div>
    </>
  );
}
