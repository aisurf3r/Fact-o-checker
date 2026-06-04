# FACT·O·CHECKER 🔍

**Autonomous OSINT & Narrative Intelligence Agent** 🤖

Fact·O·Checker is a production-grade news verification system that combines deterministic infrastructure analysis with an autonomous AI reasoning agent. Paste any news headline, claim, or URL and receive a structured verdict backed by real-time web search, domain reputation data, and WHOIS registration analysis.

<img width="1064" height="957" alt="{E64508A4-7C0B-400A-AB1E-FCEDF781757A}" src="https://github.com/user-attachments/assets/7610dbd1-7f4a-4b20-a60c-e56a7bf7d88f" />

---

## ✨ How It Works: Hybrid Agentic Architecture

Fact·O·Checker uses a deliberate two-phase architecture that maximises reliability without sacrificing autonomy.

### ⚙️ Phase 1 — Deterministic Pre-Processing

When the input contains a URL, the system handler immediately extracts the domain and fires three infrastructure checks **in parallel**, before the AI agent is even initialised:

```
URL input detected
       │
       ▼
extractDomain()  ──────────────────────────────────────────────────
       │                                                           │
       ├── fetchVirusTotal(domain)  ← VirusTotal API v3            │
       ├── fetchWhois(domain)       ← RDAP (ICANN standard)        │  Promise.all
       └── ──────────────────────────────────────────────────────► │
                                                                   │
                    Results injected into agent prompt ◄───────────┘
```

These checks are **always executed** when a URL is present — they do not depend on the AI model deciding to call them. This eliminates a key failure mode in purely agentic systems: model discretion over whether to invoke tools.

The raw JSON results from VirusTotal and WHOIS are injected verbatim into the user prompt so the agent works with exact, unmodified data:

```
--- Infrastructure Analysis (use these exact values for flags) ---
WHOIS data: {"domain":"elpais.com","registrar":"Ascio Technologies","ageDays":9221,...}
VirusTotal data: {"malicious":0,"harmless":62,"categories":["news and media"],...}
---
```

### ⚙️ Phase 2 — Agentic Synthesis (Llama-3.3-70b via Groq)

With the infrastructure data already in context, the agent focuses on what it does best: **autonomous web research and narrative analysis**.

The agent runs a ReAct (Reasoning + Acting) loop using the Vercel AI SDK's `generateText` with `maxSteps: 5`. In each step it can:

- Formulate and execute Tavily search queries
- Reformulate queries if results are insufficient
- Cross-reference multiple sources
- Detect fact-checker coverage (Maldita, Snopes, AFP, etc.)
- Synthesise all evidence into a structured JSON verdict

The agent decides autonomously how many searches to run, what angles to investigate, and when it has enough evidence to deliver a verdict.

### 🔀 Why This Hybrid Approach

| Concern | Pure Agentic | Pure Deterministic | Hybrid (Fact·O·Checker) |
|---|---|---|---|
| VT + WHOIS always run | ✗ Model may skip | ✓ | ✓ |
| Web research quality | ✓ Autonomous | ✗ Fixed queries | ✓ Autonomous |
| Token efficiency | ✗ Wastes steps on infra | — | ✓ Infra pre-loaded |
| Hallucinated flags | ✗ Risk | ✓ None | ✓ Data injected |
| Adaptability | ✓ | ✗ | ✓ |

The model is still the reasoning engine. It decides what to search, how many times, and what conclusion to draw. It just receives infrastructure data as a given rather than having to fetch it itself.

---

## ⚖️ Verdict System

Each verification returns one of four verdicts:

| Verdict | Meaning | Color |
|---|---|---|
| **REAL** | Multiple credible sources corroborate the claim | Sky blue |
| **FAKE** | Claim contradicted by credible sources or satire detected | Red |
| **SUSPICIOUS** | Domain < 30 days old, conflicting sources, or no credible corroboration | Amber |
| **UNVERIFIABLE** | No sources found; claim cannot be confirmed or denied | Gray |

Alongside the verdict: a confidence score (0–100), a plain-language summary in the input language, source links, and structured flags.

---

## 🚩 Flag System

Flags are colour-coded by severity:

** 🟢 Green — informational/positive**
- `Domain registered X days ago (since YEAR)`
- `Registrar: [name]`
- `Registrant country: [code]`
- `VirusTotal: clean — 0 malicious, X harmless votes`
- `Hosting category: [news / media / etc]`
- `Fact-checked by: maldita.es` *(detected from Tavily results)*

** 🟡 Amber — caution**
- Conflicting source quality
- Unverifiable claims

** 🔴 Red — critical**
- `Domain registered less than 30 days ago ⚠️`
- `VirusTotal: X malicious votes detected ⚠️`

---

## 🛠️ Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | Serverless-first |
| AI Reasoning | Llama-3.3-70b | Via Groq — fast inference, generous free tier |
| AI SDK | Vercel AI SDK (`ai@4.3.19`) | `generateText` + `maxSteps` ReAct loop |
| Web Search | Tavily Search API | Optimised for LLM agents; 1,000 searches/month free |
| Domain Reputation | VirusTotal API v3 | 500 req/day free |
| WHOIS / Registration | RDAP (ICANN) | HTTP standard, no API key required |
| Bot Protection | hCaptcha (invisible) | Serverside token verification |
| UI | shadcn/ui + Tailwind CSS v4 | Modernist Glassmorphic Light design |
| Font | Inter (Google Fonts) | Weights 300 / 500 / 700 / 900 |
| Deployment | Vercel | 60s function timeout configured |

---

## </> Getting Started

### Prerequisites

- Node.js 18+
- Accounts for: [Groq](https://console.groq.com), [Tavily](https://tavily.com), [VirusTotal](https://virustotal.com), [hCaptcha](https://hcaptcha.com)

### 📦 Installation

```bash
git clone https://github.com/aisurf3r/Fact-o-checker.git
cd Fact-o-checker
npm install
```

### 🗝️ Environment Variables

Create `.env.local` in the project root:

```env
GROQ_API_KEY=           # Groq console → API Keys
TAVILY_API_KEY=         # Tavily dashboard → API
VIRUSTOTAL_API_KEY=     # VirusTotal → API Key
HCAPTCHA_SECRET_KEY=    # hCaptcha dashboard → Secret Key
```

### 🚀 Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** 📝 The agent makes outbound HTTP requests to Groq, Tavily, VirusTotal and RDAP. These calls require a real server environment. The Bolt/StackBlitz WebContainer may block external API calls due to CORS related behaviour — deploy to server enviroment for full functionality.

---

## API Reference

### `POST /api/verify`

**Request body:**
```json
{
  "input": "https://example.com/article  OR  plain text claim",
  "hcaptchaToken": "token-from-frontend-widget"
}
```

**Response:**
```json
{
  "verdict": {
    "verdict": "REAL | FAKE | SUSPICIOUS | UNVERIFIABLE",
    "confidence": 85,
    "summary": "Plain-language explanation in the input language.",
    "sources": ["https://...", "https://..."],
    "flags": ["Domain registered 9221 days ago (since 2001)", "VirusTotal: clean — 0 malicious, 62 harmless votes"]
  },
  "steps": 3,
  "infraChecked": true,
  "domain": "elpais.com"
}
```

**Fields:**
- `infraChecked` — `true` if input was a URL and VT + WHOIS were executed
- `domain` — extracted hostname (present when `infraChecked` is `true`)
- `steps` — number of ReAct reasoning steps the agent completed

---

## 🆓 Free Tier Limits

| Service | Free Tier | Bottleneck |
|---|---|---|
| Groq (Llama-3.3-70b) | 1,000 req/day | Not critical for personal use |
| Tavily | **1,000 searches/month** | Primary bottleneck (~2 searches/verification = ~500 verifications/month) |
| VirusTotal | 500 req/day | Not critical |
| RDAP | Unlimited | No key required |
| hCaptcha | 1M verifications/month | Not critical |

---

## 🏗️  Project Structure

```
app/
  api/verify/
    route.ts          POST endpoint — pre-processing + agent
  layout.tsx          Root layout, metadata, fonts
  page.tsx            UI: Idle / Loading / Result states
  globals.css         Tailwind base + custom animations
  favicon.ico         Site icon
```

---

## 🎨 Design System

The interface follows a **Modernist Glassmorphic Light** aesthetic:

```css
Background:   linear-gradient(135deg, #e0f2fe, #f0fdf4, #f8fafc)
Cards:        rgba(255,255,255,0.72) + backdrop-filter: blur(20px)
Accent A:     #0EA5E9  (sky blue  — primary actions, REAL verdict)
Accent B:     #10B981  (emerald   — success states, positive flags)
Danger:       #EF4444  (red       — FAKE verdict, critical flags)
Warning:      #F59E0B  (amber     — SUSPICIOUS, caution flags)
Typography:   Inter 300 / 500 / 700 / 900
Monospace:    Consolas (data fields, domain names, API values)
```

---

## 🌐 Roadmap

| Phase | Status | Description |
|---|---|---|
| V1 — Core | ✅ Live | Hybrid agent: deterministic infra + agentic web search |
| V2 — Cache | Planned | Supabase cache layer — `hash(input)` → cached verdict, zero tokens on repeated queries |
| V3 — Global Watch | Planned | Mapbox dashboard — domain IP geolocation, disinformation heatmaps, `flyTo()` animations |
| Scale | Future | Enterprise API, rate limiting, usage analytics |

---

## 📝 License

MIT

---

<sub>Developer: [aisurf3r](https://github.com/aisurf3r) · Brain: Llama-3.3-70b via Groq · Contact: aisurf3r@gmail.com</sub>
