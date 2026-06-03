"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  Shield,
  Globe,
  Search,
  ExternalLink,
  AlertTriangle,
  ChevronRight,
  RotateCcw,
} from "lucide-react"
import HCaptcha from "@hcaptcha/react-hcaptcha"

function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ")
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isUrl(input: string): boolean {
  try {
    const url = new URL(input.trim())
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

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
]

// ─── Sub-components ───────────────────────────────────────────────────────────

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

const FLIP_COLORS = [
  "#4ABEED",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#3B82F6",
  "#8B5CF6",
  "#06B6D4",
  "#F97316",
]

function FlipO({ compact = false }: { compact?: boolean }) {
  const [colorIndex, setColorIndex] = useState(0)
  const [flipping, setFlipping] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setFlipping(true)
      setTimeout(() => {
        setColorIndex((prev) => (prev + 1) % FLIP_COLORS.length)
      }, 300)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!flipping) return
    const timer = setTimeout(() => setFlipping(false), 600)
    return () => clearTimeout(timer)
  }, [flipping])

  return (
    <span
      className={cn("flip-o-letter inline-block", flipping ? "flip-o-animate" : "")}
      style={{ color: FLIP_COLORS[colorIndex] }}
      aria-label="O"
    >
      O
    </span>
  )
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center select-none", compact ? "gap-1" : "gap-2")}>
      <div
        className={cn(
          "font-black tracking-tighter leading-none",
          compact ? "text-2xl sm:text-3xl" : "text-4xl sm:text-6xl md:text-7xl"
        )}
        style={{ fontWeight: 900 }}
      >
        <span className="text-slate-900">FACT·</span>
        <FlipO compact={compact} />
        <span className="text-slate-900">·</span>
        <span style={{ color: "#4ABEED" }}>CHECKER</span>
      </div>
      {!compact && (
        <p className="text-xs sm:text-sm font-light tracking-[0.2em] sm:tracking-[0.3em] text-slate-400 uppercase text-center">
          Autonomous OSINT Verification Agent
        </p>
      )}
    </div>
  )
}

function CapabilityPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="capability-pill glass-card flex flex-1 items-center justify-center gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 py-2.5 cursor-default min-w-0">
      <Icon size={13} className="text-sky-500 shrink-0" />
      <span className="text-xs font-medium text-slate-600 truncate">{label}</span>
    </div>
  )
}

// ─── Idle State ───────────────────────────────────────────────────────────────

function IdleState({ onSubmit }: { onSubmit: (input: string, token: string) => void }) {
  const [value, setValue] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const hcaptchaRef = useRef<HCaptcha>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim() && !isExecuting) {
      setIsExecuting(true)
      hcaptchaRef.current?.execute()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (value.trim() && !isExecuting) {
        setIsExecuting(true)
        hcaptchaRef.current?.execute()
      }
    }
  }

  const handleVerify = useCallback((token: string) => {
    setIsExecuting(false)
    hcaptchaRef.current?.resetCaptcha()
    onSubmit(value.trim(), token)
  }, [value, onSubmit])

  const handleExpire = () => {
    setIsExecuting(false)
    hcaptchaRef.current?.resetCaptcha()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8 sm:gap-10">
        <Logo />

        <div className="w-full flex flex-col gap-1.5">
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
              placeholder="Paste a news headline, claim, or URL to verify… e.g. &quot;NASA confirms water on Mars&quot; or https://suspicious-news.net/story"
              rows={5}
              className="w-full resize-none bg-transparent px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 text-sm sm:text-base font-light text-slate-800 placeholder:text-slate-400 focus:outline-none"
              style={{ fontFamily: "inherit" }}
            />
            <div className="flex items-center justify-between border-t border-white/60 bg-white/30 px-4 sm:px-6 py-3">
              <span className="text-xs text-slate-400 font-light">
                {value.length > 0 ? `${value.length} characters` : "⌘ + Enter to submit"}
              </span>
              <button
                type="submit"
                disabled={!value.trim() || isExecuting}
                className={cn(
                  "shimmer-btn flex items-center gap-2 rounded-xl px-4 sm:px-5 py-2 sm:py-2.5 text-sm font-semibold text-white transition-all duration-200",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none disabled:bg-slate-400"
                )}
                style={!value.trim() || isExecuting ? { background: "#94a3b8", animation: "none" } : {}}
              >
                Verify
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          {/* hCaptcha invisible — inside form, no flex impact */}
          <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
            <HCaptcha
              ref={hcaptchaRef}
              sitekey="4d2cfb8a-af1a-4eac-8f78-83ccdbc4b60c"
              size="invisible"
              theme="light"
              onVerify={handleVerify}
              onExpire={handleExpire}
            />
          </div>
        </form>

        <p className="w-full text-xs text-slate-400 font-light text-center px-2">
          This site is protected by hCaptcha and its{" "}
          <a href="https://www.hcaptcha.com/privacy" target="_blank" rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-slate-300 hover:decoration-slate-500 transition-colors">
            Privacy Policy
          </a>{" "}and{" "}
          <a href="https://www.hcaptcha.com/terms" target="_blank" rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-slate-300 hover:decoration-slate-500 transition-colors">
            Terms of Service
          </a>{" "}apply.
        </p>
        </div>

        <div className="flex w-full items-stretch gap-2 sm:gap-3">
          {CAPABILITY_PILLS.map((pill) => (
            <CapabilityPill key={pill.label} icon={pill.icon} label={pill.label} />
          ))}
        </div>

        <p className="text-xs text-slate-400 font-light text-center max-w-md px-2">
          Powered by Llama-3.3-70b · Tavily Search · VirusTotal · RDAP ·{" "}
          <a
            href="https://github.com/aisurf3r/Fact-o-checker"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-slate-300 hover:decoration-slate-500 transition-colors"
          >
            GitHub
          </a>
        </p>

      </div>
    </div>
  )
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState({
  input,
  isReady,
  onComplete,
  stepCount,
}: {
  input: string
  isReady: boolean
  onComplete: () => void
  stepCount: number
}) {
  const [visibleSteps, setVisibleSteps] = useState<number[]>([])
  const [showFinal, setShowFinal] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  // Reveal steps progressively — keep last one blinking until agent responds
  useEffect(() => {
    const timers = LOADING_STEPS.slice(0, stepCount).map((_, i) =>
      setTimeout(() => {
        setVisibleSteps((prev) => (prev.includes(i) ? prev : [...prev, i]))
      }, i * 900)
    )
    return () => timers.forEach(clearTimeout)
  }, [stepCount])

  // When agent responds: show final step, fade, notify parent
  useEffect(() => {
    if (!isReady) return
    setShowFinal(true)
    const fadeTimer = setTimeout(() => setIsComplete(true), 600)
    const doneTimer = setTimeout(() => onComplete(), 1300)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [isReady, onComplete])

  const formatStepNum = (i: number) => String(i + 1).padStart(2, "0")

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-16 transition-opacity duration-700",
        isComplete ? "opacity-0" : "opacity-100"
      )}
    >
      <div className="w-full max-w-2xl flex flex-col items-center gap-6 sm:gap-10">
        <Logo compact />

        <div className="glass-card w-full rounded-2xl px-4 sm:px-5 py-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-2">
            Analyzing
          </p>
          <p className="text-xs sm:text-sm font-light text-slate-700 line-clamp-2 font-mono break-all">
            {input}
          </p>
        </div>

        <div
          className="w-full rounded-2xl overflow-hidden"
          style={{
            background: "rgba(15, 23, 42, 0.96)",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.25)",
          }}
        >
          <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-white/10">
            <span className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-green-500/70" />
            <span className="ml-1.5 sm:ml-2 text-xs font-mono text-slate-500 truncate">
              osint-agent · fact-o-checker
            </span>
          </div>

          <div className="px-3 sm:px-6 py-4 sm:py-5 font-mono text-xs sm:text-sm min-h-[180px] sm:min-h-[240px] flex flex-col gap-1.5 sm:gap-2 overflow-y-auto max-h-[50vh] sm:max-h-[60vh]">
            {visibleSteps.map((i) => {
              const isLast = i === Math.max(...visibleSteps) && !showFinal
              return (
                <div
                  key={i}
                  className={cn("step-fade-in flex gap-2 sm:gap-3", isLast ? "cursor-blink" : "")}
                >
                  <span className="text-slate-600 shrink-0 text-xs sm:text-sm">
                    [{formatStepNum(i)}]
                  </span>
                  <span
                    className={cn(
                      "break-words min-w-0",
                      isLast ? "text-sky-400" : "text-slate-400"
                    )}
                  >
                    {LOADING_STEPS[i]}
                  </span>
                </div>
              )
            })}
            {showFinal && (
              <div className="step-fade-in flex gap-2 sm:gap-3">
                <span className="text-slate-600 shrink-0 text-xs sm:text-sm">
                  [{formatStepNum(stepCount)}]
                </span>
                <span className="text-emerald-400 break-words min-w-0 font-semibold">
                  ✓ Verdict ready — rendering result...
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse"
            style={{ animationDuration: "1s" }}
          />
          <p className="text-xs text-slate-400 font-light text-center">
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
    <div className="flex min-h-screen flex-col items-center px-4 sm:px-6 py-12 sm:py-16 card-in">
      <div className="w-full max-w-2xl flex flex-col items-center gap-6 sm:gap-8">
        <div className="flex w-full items-center justify-between gap-3">
          <Logo compact />
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 sm:gap-2 rounded-xl border border-slate-200 bg-white/60 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-slate-600 transition-all hover:bg-white/90 hover:shadow-sm shrink-0"
          >
            <RotateCcw size={13} />
            New check
          </button>
        </div>

        <div className="glass-card w-full rounded-2xl px-4 sm:px-5 py-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1.5">
            Verified
          </p>
          <p className="text-xs sm:text-sm font-light text-slate-700 line-clamp-2 font-mono break-all">
            {input}
          </p>
        </div>

        <div className="card-in glass-card w-full rounded-2xl overflow-hidden">
          <div className="h-1 w-full" style={{ background: cfg.color }} />

          <div className="p-5 sm:p-7 flex flex-col gap-5 sm:gap-6">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-4 sm:px-5 py-1.5 sm:py-2 text-base sm:text-lg font-bold tracking-wider",
                  cfg.bgLight,
                  cfg.textColor
                )}
              >
                {cfg.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-2xl sm:text-3xl font-black text-slate-800">
                  {v.confidence}
                  <span className="text-base sm:text-lg font-semibold text-slate-400">%</span>
                </span>
                <span className="text-sm text-slate-400 font-light">confidence</span>
              </div>

              {infraChecked && domain && (
                <div
                  className="flex items-center gap-1.5 sm:gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "#10B981",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                  }}
                >
                  <Shield size={11} />
                  <span>Infra checked: </span>
                  <span className="font-mono truncate max-w-[120px] sm:max-w-none">{domain}</span>
                </div>
              )}
            </div>

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

            <p className="text-sm sm:text-base font-light leading-relaxed text-slate-700">
              {v.summary}
            </p>

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

            {v.sources && v.sources.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Sources
                </p>
                <div className="flex flex-col gap-1.5">
                  {v.sources.map((src, i) => (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-sky-700 transition-all hover:shadow-sm w-full overflow-hidden"
                      style={{
                        background: "rgba(14, 165, 233, 0.08)",
                        border: "1px solid rgba(14, 165, 233, 0.25)",
                      }}
                    >
                      <ExternalLink size={11} className="shrink-0" />
                      <span className="truncate">{src}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

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
  const [pendingResult, setPendingResult] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (userInput: string, hcaptchaToken: string) => {
    setInput(userInput)
    setError(null)
    setResult(null)
    setPendingResult(null)
    setAppState("loading")

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: userInput, hcaptchaToken }),
      })

      const data: ApiResponse = await res.json()

      if (!res.ok || data.error) {
        setError(data.error ?? "Verification failed. Please try again.")
        setAppState("idle")
        return
      }

      setPendingResult(data)
    } catch {
      setError("Network error. Please check your connection and try again.")
      setAppState("idle")
    }
  }

  const handleLoadingComplete = () => {
    setResult(pendingResult)
    setPendingResult(null)
    setAppState("result")
  }

  const handleReset = () => {
    setAppState("idle")
    setResult(null)
    setPendingResult(null)
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
              <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] sm:w-auto max-w-sm sm:max-w-none">
                <div
                  className="glass-card flex items-center gap-3 rounded-xl px-4 sm:px-5 py-3 text-sm text-red-700"
                  style={{ border: "1px solid rgba(239,68,68,0.3)" }}
                >
                  <AlertTriangle size={16} className="text-red-500 shrink-0" />
                  {error}
                </div>
              </div>
            )}
          </>
        )}

        {appState === "loading" && (
          <LoadingState
            input={input}
            isReady={pendingResult !== null}
            onComplete={handleLoadingComplete}
            stepCount={isUrl(input) ? 9 : 5}
          />
        )}

        {appState === "result" && result && (
          <ResultState result={result} input={input} onReset={handleReset} />
        )}
      </div>
    </div>
  )
}
