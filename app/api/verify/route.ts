import { groq } from '@ai-sdk/groq'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'

const FETCH_TIMEOUT_MS = 8000

function extractDomain(input: string): string | null {
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.hostname.replace(/^www\./, '')
  } catch {
    // Try adding protocol for bare domains like "noticias-fake.net"
    try {
      const url = new URL(`https://${trimmed}`)
      if (url.hostname.includes('.') && !trimmed.includes(' ')) {
        return url.hostname.replace(/^www\./, '')
      }
    } catch {}
    return null
  }
}

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function verifyHCaptcha(token: string): Promise<boolean> {
  const secret = process.env.HCAPTCHA_SECRET_KEY
  if (!secret) {
    console.warn('HCAPTCHA_SECRET_KEY not set — skipping captcha verification')
    return true
  }
  try {
    const res = await fetchWithTimeout('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
    })
    const data = await res.json()
    return data.success === true
  } catch {
    console.error('hCaptcha verification failed')
    return false
  }
}

const SYSTEM_PROMPT = `You are a Senior OSINT Officer specialized in disinformation detection.

When given a URL or a news claim, your job is to:
1. Search for the claim or URL using the tavily_search tool to find corroborating or contradicting sources
2. If a domain is provided in the prompt, ALWAYS call virustotal_check AND whois_lookup on it before forming a verdict
3. Analyze the results for factual discrepancies and infrastructure red flags
4. Return a structured JSON verdict

Your verdict must ALWAYS be valid JSON with this exact shape:
{
  "verdict": "REAL" | "FAKE" | "SUSPICIOUS" | "UNVERIFIABLE",
  "confidence": 0-100,
  "summary": "One paragraph explanation of your finding",
  "sources": ["url1", "url2", "url3", "url4", "url5"],
  "flags": ["list of red flags if any"]
}

Rules:
- ONLY if you called whois_lookup AND received real data: add these flags from the actual tool result:
  * Domain age: "Domain registered X days ago (since YEAR)" — use the exact ageDays value from the tool result
  * Registrar: "Registrar: [registrar name]" — only if registrar field is not null
  * If ageDays < 30: also set verdict to SUSPICIOUS
- ONLY if you called virustotal_check AND received real data: add these flags from the actual tool result:
  * Reputation: "VirusTotal: clean — 0 malicious, X harmless votes" OR "VirusTotal: X malicious votes detected ⚠️"
  * Categories: "Hosting category: [category]" — only if categories array is not empty
- ABSOLUTE RULE: if you did NOT call whois_lookup, you MUST NOT add any flag mentioning domain age, registration date, or domain history. Zero exceptions.
- ABSOLUTE RULE: if you did NOT call virustotal_check, you MUST NOT add any flag mentioning VirusTotal, malicious votes, or reputation. Zero exceptions.
- ABSOLUTE RULE: if the input was plain text with no URL, do NOT add any infrastructure flags whatsoever.
- ONLY if you called whois_lookup: you MUST add "Registrant country: [country code]" if registrantCountry is not null. You MUST add "Registrar: [name]" if registrar is not null.
- ONLY if you called virustotal_check: you MUST add "Hosting category: [categories]" if categories array is not empty. Never skip this.
- ALWAYS scan the Tavily search result URLs for known fact-checking domains. If any result URL contains: maldita.es, newtral.es, snopes.com, factcheck.org, afpfactcheck.com, politifact.com, verificat.cat, fullfact.org, chequeado.com — add flag "Fact-checked by: [domain name]". This is a positive signal.
- If multiple credible sources corroborate the claim, lean toward REAL
- If no sources found at all, return UNVERIFIABLE
- Always use the search tool before making a verdict — never guess
- Include ALL relevant sources found in the sources array — minimum 3 when available, up to 8. Never truncate sources.
- CRITICAL: You MUST respond in the exact same language as the input. If the input is in Spanish, the entire summary must be in Spanish. If in English, in English and so on. Never switch languages.
- Return ONLY the JSON object, no markdown, no preamble`

export async function POST(req: NextRequest) {
  try {
    const { input, hcaptchaToken } = await req.json()

    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 })
    }

    if (!hcaptchaToken || typeof hcaptchaToken !== 'string') {
      return NextResponse.json({ error: 'Missing captcha token' }, { status: 400 })
    }

    const captchaValid = await verifyHCaptcha(hcaptchaToken)
    if (!captchaValid) {
      return NextResponse.json({ error: 'Captcha verification failed' }, { status: 403 })
    }

    const vtKey = process.env.VIRUSTOTAL_API_KEY
    if (!vtKey) console.warn('VIRUSTOTAL_API_KEY is not set — domain reputation checks will be skipped')

    const domain = extractDomain(input)
    const prompt = domain
      ? `Verify the following: ${input}\n\nExtracted domain: ${domain}\nYou MUST call BOTH virustotal_check("${domain}") AND whois_lookup("${domain}") before forming your verdict. These are mandatory steps, not optional.`
      : `Verify the following: ${input}\n\nIMPORTANT: This is plain text, NOT a URL. Do NOT call virustotal_check or whois_lookup. Do NOT add any infrastructure or domain flags.`

    const { text, steps } = await generateText({
      model: groq('llama-3.3-70b-versatile'),
      system: SYSTEM_PROMPT,
      prompt,
      // @ts-ignore
      maxSteps: 7,
      tools: {
        tavily_search: tool({
          description: 'Search the web for real-time information to verify claims or investigate URLs.',
          parameters: z.object({
            query: z.string().describe('The search query to investigate'),
          }),
          execute: async ({ query }) => {
            try {
              const res = await fetchWithTimeout('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  api_key: process.env.TAVILY_API_KEY,
                  query,
                  search_depth: 'basic',
                  max_results: 5,
                  include_answer: true,
                }),
              })
              if (!res.ok) return { error: `Tavily error: ${res.status}`, results: [] }
              const data = await res.json()
              return {
                answer: data.answer ?? null,
                results: (data.results ?? []).map((r: {
                  title: string; url: string; content: string; score: number
                }) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.content?.slice(0, 300),
                  score: r.score,
                })),
              }
            } catch (err: unknown) {
              const isTimeout = err instanceof Error && err.name === 'AbortError'
              return { error: isTimeout ? 'Tavily timeout' : `Tavily error: ${String(err)}`, results: [] }
            }
          },
        }),

        virustotal_check: tool({
          description: 'Check a domain\'s reputation and malware history via VirusTotal.',
          parameters: z.object({
            domain: z.string().describe('The domain to check, e.g. "suspicious-news.net"'),
          }),
          execute: async ({ domain }) => {
            if (!vtKey) return { error: 'VirusTotal API key not configured' }
            try {
              const res = await fetchWithTimeout(
                `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`,
                { headers: { 'x-apikey': vtKey } }
              )
              if (!res.ok) return { error: `VirusTotal error: ${res.status}` }
              const data = await res.json()
              const stats = data?.data?.attributes?.last_analysis_stats ?? {}
              const categories = data?.data?.attributes?.categories ?? {}
              return {
                domain,
                reputation: data?.data?.attributes?.reputation ?? null,
                malicious: stats.malicious ?? 0,
                suspicious: stats.suspicious ?? 0,
                harmless: stats.harmless ?? 0,
                categories: Object.values(categories).slice(0, 3),
              }
            } catch (err: unknown) {
              const isTimeout = err instanceof Error && err.name === 'AbortError'
              return { error: isTimeout ? 'VirusTotal timeout' : `VirusTotal error: ${String(err)}` }
            }
          },
        }),

        whois_lookup: tool({
          description: 'Look up domain registration data via RDAP to detect freshly registered fake news outlets.',
          parameters: z.object({
            domain: z.string().describe('The domain to look up, e.g. "suspicious-news.net"'),
          }),
          execute: async ({ domain }) => {
            try {
              const res = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(domain)}`)
              if (!res.ok) return { error: `RDAP error: ${res.status}` }
              const data = await res.json()
              const registrationEvent = (data.events ?? []).find(
                (e: { eventAction: string; eventDate: string }) => e.eventAction === 'registration'
              )
              const createdAt: string | null = registrationEvent?.eventDate ?? null
              const ageDays = createdAt
                ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
                : null
              const vcardArr = data.entities?.[0]?.vcardArray?.[1]
              const fnEntry = Array.isArray(vcardArr)
                ? vcardArr.find((v: unknown[]) => Array.isArray(v) && v[0] === 'fn')
                : null
              return {
                domain,
                registrar: fnEntry?.[3] ?? null,
                createdAt,
                ageDays,
                freshDomain: ageDays !== null ? ageDays < 30 : null,
              }
            } catch (err: unknown) {
              const isTimeout = err instanceof Error && err.name === 'AbortError'
              return { error: isTimeout ? 'RDAP timeout' : `RDAP error: ${String(err)}` }
            }
          },
        }),
      },
    })

    const candidateTexts = [text, ...steps.map((s) => s.text ?? '').filter(Boolean)]
    let verdict
    let parsed = false

    for (const candidate of candidateTexts) {
      try {
        const jsonMatch = candidate.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          verdict = JSON.parse(jsonMatch[0])
          parsed = true
          break
        }
      } catch {
        // try next candidate
      }
    }

    if (!parsed) {
      verdict = {
        verdict: 'UNVERIFIABLE',
        confidence: 0,
        summary: candidateTexts.join(' ').slice(0, 500) || 'Agent returned no text',
        sources: [],
        flags: ['Agent response was not valid JSON'],
      }
    }

    return NextResponse.json({
      verdict,
      steps: steps.length,
      infraChecked: domain !== null,
      domain: domain ?? undefined,
    })

  } catch (err) {
    console.error('Agent error:', err)
    return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
  }
}
