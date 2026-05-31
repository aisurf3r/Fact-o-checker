"use client"

import { useState, useEffect } from "react"
import {
  Shield,
  Globe,
  Search,
  Zap,
  ExternalLink,
  AlertTriangle,
  ChevronRight,
  RotateCcw,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ─── Types ───────────────────────────────────────────────────────────────────

type AppState = "idle" | "loading" | "result"

type VerdictType = "REAL" | "FAKE" | "SUSPICIOUS" | "UNVERIFIABLE"

interface VerdictData {
  verdict: VerdictType
  confidence: number
  summary: string
  sources: string[]
  flags: string[]
}

interface ApiResponse {
  verdict: VerdictData
  steps: number
  infraChecked: boolean
  domain?: string
  error?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  "Initializing OSINT agent...",
  "Dispatching web search queries...",
  "Searching corroborating sources...",
  "Running infrastructure checks...",
  "Querying domain reputation database...",
  "Performing WHOIS / RDAP lookup...",
  "Cross-referencing fact databases...",
  "Computing confidence score...",
  "Generating final verdict...",
]

const VERDICT_CONFIG: Record<
  VerdictType,
  { color: string; borderColor: string; bgLight: string; label: string; textColor: string }
> = {
  REAL: {
    color: "#0EA5E9",
    borderColor: "border-sky-500",
    bgLight: "bg-sky-50",
    label: "REAL",
    textColor: "text-sky-600",
  },
  FAKE: {
    color: "#EF4444",
    borderColor: "border-red-500",
    bgLight: "bg-red-50",
    label: "FAKE",
    textColor: "text-red-600",
  },
  SUSPICIOUS: {
    color: "#F59E0B",
    borderColor: "border-amber-500",
    bgLight: "bg-amber-50",
    label: "SUSPICIOUS",
    textColor: "text-amber-600",
  },
  UNVERIFIABLE: {
    color: "#6B7280",
    borderColor: "border-gray-400",
    bgLight: "bg-gray-50",
    label: "UNVERIFIABLE",
    textColor: "text-gray-500",
  },
}

const CAPABILITY_PILLS = [
  { icon: Globe, label: "Web OSINT" },
  { icon: Shield, label: "Domain Reputation" },
  { icon: Search, label: "WHOIS Lookup" },
  { icon: Zap, label: "Smart Cache" },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateUrl(url: string, max = 48): string {
  try {
    const u = new URL(url)
    const short = u.hostname + u.pathname
    return short.length > max ? short.slice(0, max) + "…" : short
  } catch {
    return url.length > max ? url.slice(0, max) + "…" : url
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AnimatedBlobs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <div
        className="animate-blob animation-delay-0 absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full opacity-40"
        style={{ background: "radial-gradient(circle, #bae6fd 0%, transparent 70%)" }}
      />
      <div
        className="animate-blob animation-delay-2000 absolute top-1/2 -right-40 h-[420px] w-[420px] rounded-full opacity-30"
        style={{ background: "radial-gradient(circle, #bbf7d0 0%, transparent 70%)" }}
      />
      <div
        className="animate-blob animation-delay-4000 absolute -bottom-24 left-1/3 h-[380px] w-[380px] rounded-full opacity-35"
        style={{ background: "radial-gradient(circle, #e0f2fe 0%, transparent 70%)" }}
      />
    </div>
  )
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center select-none",
        compact ? "gap-1" : "gap-2"
      )}
    >
      <div
        className={cn(
          "font-black tracking-tighter leading-none",
          compact ? "text-3xl" : "text-6xl md:text-7xl"
        )}
        style={{ fontWeight: 900 }}
      >
        <span className="text-slate-900">FACT·O·</span>
        <span style={{ color: "#0EA5E9" }}>CHECKER</span>
      </div>
      {!compact && (
        <p className="text-sm font-light tracking-[0.3em] text-slate-400 uppercase">
          Autonomous OSINT Verification Agent
        </p>
      )}
    </div>
  )
}

function CapabilityPill({
  icon: Icon,
  label,
}: {
  icon: React.ElementType
  label: string
}) {
  return (
    <div
      className="capability-pill glass-card flex items-center gap-2 rounded-full px-4 py-2 cursor-default"
    >
      <Icon size={14} className="text-sky-500" />
      <span className="text-xs font-medium text-slate-600">{label}</span>
    </div>
  )
}

// ─── Idle State ───────────────────────────────────────────────────────────────

function IdleState({
  onSubmit,
}: {
  onSubmit: (input: string) => void
}) {
  const [value, setValue] = useState("")
  const [isFocused, setIsFocused] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (value.trim()) onSubmit(value.trim())
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-10">
        {/* Logo */}
        <Logo />

        {/* Input form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div
            className={cn(
              "glow-focus-wrapper glass-card rounded-2xl overflow-hidden transition-all duration-300",
              isFocused ? "border-sky-300" : "border-white/90"
            )}
          >
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="Paste a news headline, claim, or URL to verify…&#10;&#10;e.g. &quot;NASA confirms water on Mars&quot; or https://suspicious-news.net/story"
              rows={5}
              className="w-full resize-none bg-transparent px-6 pt-5 pb-4 text-base font-light text-slate-800 placeholder:text-slate-400 focus:outline-none"
              style={{ fontFamily: "inherit" }}
            />
            <div className="flex items-center justify-between border-t border-white/60 bg-white/30 px-6 py-3">
              <span className="text-xs text-slate-400 font-light">
                {value.length > 0 ? `${value.length} characters` : "⌘ + Enter to submit"}
              </span>
              <button
                type="submit"
                disabled={!value.trim()}
                className={cn(
                  "shimmer-btn flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none disabled:bg-slate-400"
                )}
                style={!value.trim() ? { background: "#94a3b8", animation: "none" } : {}}
              >
                Verify
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </form>

        {/* Capability pills */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {CAPABILITY_PILLS.map((pill) => (
            <CapabilityPill key={pill.label} icon={pill.icon} label={pill.label} />
          ))}
        </div>

        <p className="text-xs text-slate-400 font-light text-center max-w-md">
          Powered by Gemini 1.5 Flash · Tavily Search · VirusTotal · RDAP
        </p>
      </div>
    </div>
  )
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState({ input }: { input: string }) {
  const [visibleSteps, setVisibleSteps] = useState<number[]>([])

  useEffect(() => {
    const intervals = [0, 900, 1800, 2700, 3500, 4400, 5300, 6100, 6900]

    const timers = intervals.map((delay, i) =>
      setTimeout(() => {
        setVisibleSteps((prev) => {
          if (prev.includes(i)) return prev
          return [...prev, i]
        })
      }, delay)
    )

    return () => timers.forEach(clearTimeout)
  }, [])

  const formatStepNum = (i: number) => String(i + 1).padStart(2, "0")

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-10">
        <Logo compact />

        {/* Input preview */}
        <div className="glass-card w-full rounded-2xl px-5 py-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-2">
            Analyzing
          </p>
          <p className="text-sm font-light text-slate-700 line-clamp-2 font-mono">
            {input}
          </p>
        </div>

        {/* Terminal */}
        <div
          className="w-full rounded-2xl overflow-hidden"
          style={{
            background: "rgba(15, 23, 42, 0.96)",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.25)",
          }}
        >
          {/* Terminal titlebar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
            <span className="h-3 w-3 rounded-full bg-green-500/70" />
            <span className="ml-2 text-xs font-mono text-slate-500">
              osint-agent · fact-o-checker
            </span>
          </div>

          {/* Terminal body */}
          <div className="px-6 py-5 font-mono text-sm min-h-[240px] flex flex-col gap-2">
            {visibleSteps.map((i) => {
              const isLast = i === Math.max(...visibleSteps)
              return (
                <div
                  key={i}
                  className={cn("step-fade-in flex gap-3", isLast ? "cursor-blink" : "")}
                >
                  <span className="text-slate-600 shrink-0">
                    [ {formatStepNum(i)} ]
                  </span>
                  <span
                    className={cn(
                      "transition-colors",
                      isLast ? "text-sky-400" : "text-slate-400"
                    )}
                  >
                    {LOADING_STEPS[i]}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse"
            style={{ animationDuration: "1s" }}
          />
          <p className="text-xs text-slate-400 font-light">
            Agent is reasoning — this may take 15–30 seconds
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Result State ─────────────────────────────────────────────────────────────

function ResultState({
  result,
  input,
  onReset,
}: {
  result: ApiResponse
  input: string
  onReset: () => void
}) {
  const [progressWidth, setProgressWidth] = useState(0)
  const { verdict: v, infraChecked, domain } = result
  const cfg = VERDICT_CONFIG[v.verdict] ?? VERDICT_CONFIG.UNVERIFIABLE

  useEffect(() => {
    const t = setTimeout(() => setProgressWidth(v.confidence), 400)
    return () => clearTimeout(t)
  }, [v.confidence])

  return (
    <div className="flex min-h-screen flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">
        {/* Logo + reset */}
        <div className="flex w-full items-center justify-between">
          <Logo compact />
          <button
            onClick={onReset}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-white/90 hover:shadow-sm"
          >
            <RotateCcw size={14} />
            New check
          </button>
        </div>

        {/* Input preview */}
        <div className="glass-card w-full rounded-2xl px-5 py-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1.5">
            Verified
          </p>
          <p className="text-sm font-light text-slate-700 line-clamp-2 font-mono">
            {input}
          </p>
        </div>

        {/* Verdict card */}
        <div
          className={cn(
            "card-in glass-card w-full rounded-2xl overflow-hidden"
          )}
        >
          {/* Colored top border */}
          <div
            className="h-1 w-full"
            style={{ background: cfg.color }}
          />

          <div className="p-7 flex flex-col gap-6">
            {/* Verdict badge + confidence */}
            <div className="flex items-center gap-4 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-5 py-2 text-lg font-bold tracking-wider",
                  cfg.bgLight,
                  cfg.textColor
                )}
              >
                {cfg.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-black text-slate-800">
                  {v.confidence}
                  <span className="text-lg font-semibold text-slate-400">%</span>
                </span>
                <span className="text-sm text-slate-400 font-light">confidence</span>
              </div>

              {/* Infra badge */}
              {infraChecked && domain && (
                <div
                  className="ml-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "#10B981",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                  }}
                >
                  <Shield size={12} />
                  Infrastructure checked: {" "}
                  <span className="font-mono">{domain}</span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="relative h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all ease-out"
                style={{
                  width: `${progressWidth}%`,
                  background: cfg.color,
                  transitionDuration: "1.2s",
                  transitionTimingFunction: "cubic-bezier(0.34, 1.2, 0.64, 1)",
                }}
              />
            </div>

            {/* Summary */}
            <p className="text-base font-light leading-relaxed text-slate-700" style={{ fontSize: "1.025rem" }}>
              {v.summary}
            </p>

            {/* Flags */}
            {v.flags && v.flags.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Flags
                </p>
                <div className="flex flex-wrap gap-2">
                  {v.flags.map((flag, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
                      style={{
                        background: "rgba(245, 158, 11, 0.1)",
                        color: "#92400e",
                        border: "1px solid rgba(245, 158, 11, 0.3)",
                      }}
                    >
                      <AlertTriangle size={11} className="shrink-0" style={{ color: "#F59E0B" }} />
                      {flag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sources */}
            {v.sources && v.sources.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Sources
                </p>
                <div className="flex flex-wrap gap-2">
                  {v.sources.map((src, i) => (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-sky-700 transition-all hover:shadow-sm"
                      style={{
                        background: "rgba(14, 165, 233, 0.08)",
                        border: "1px solid rgba(14, 165, 233, 0.25)",
                      }}
                    >
                      <ExternalLink size={11} className="shrink-0" />
                      {truncateUrl(src)}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Steps count */}
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-400 font-light font-mono">
                Agent completed {result.steps} reasoning step{result.steps !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Root Page ────────────────────────────────────────────────────────────────

export default function Page() {
  const [appState, setAppState] = useState<AppState>("idle")
  const [input, setInput] = useState("")
  const [result, setResult] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (userInput: string) => {
    setInput(userInput)
    setError(null)
    setResult(null)
    setAppState("loading")

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: userInput }),
      })

      const data: ApiResponse = await res.json()

      if (!res.ok || data.error) {
        setError(data.error ?? "Verification failed. Please try again.")
        setAppState("idle")
        return
      }

      setResult(data)
      setAppState("result")
    } catch {
      setError("Network error. Please check your connection and try again.")
      setAppState("idle")
    }
  }

  const handleReset = () => {
    setAppState("idle")
    setResult(null)
    setError(null)
    setInput("")
  }

  return (
    <div className="relative page-bg min-h-screen">
      <AnimatedBlobs />

      <div className="relative z-10">
        {appState === "idle" && (
          <>
            <IdleState onSubmit={handleSubmit} />
            {error && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                <div
                  className="glass-card flex items-center gap-3 rounded-xl px-5 py-3 text-sm text-red-700"
                  style={{ border: "1px solid rgba(239,68,68,0.3)" }}
                >
                  <AlertTriangle size={16} className="text-red-500 shrink-0" />
                  {error}
                </div>
              </div>
            )}
          </>
        )}

        {appState === "loading" && <LoadingState input={input} />}

        {appState === "result" && result && (
          <ResultState result={result} input={input} onReset={handleReset} />
        )}
      </div>
    </div>
  )
}
