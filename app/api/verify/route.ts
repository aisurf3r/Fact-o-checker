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

async function fetchVirusTotal(domain: string, vtKey: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchWithTimeout(
      `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`,
      { headers: { 'x-apikey': vtKey } }
    )
    if (!res.ok) return null
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
  } catch {
    return null
  }
}

async function fetchWhois(domain: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(domain)}`)
    if (!res.ok) return null
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
    const countryEntry = Array.isArray(vcardArr)
      ? vcardArr.find((v: unknown[]) => Array.isArray(v) && v[0] === 'adr')
      : null
    return {
      domain,
      registrar: fnEntry?.[3] ?? null,
      createdAt,
      ageDays,
      freshDomain: ageDays !== null ? ageDays < 30 : null,
      registrantCountry: countryEntry?.[1]?.['country-name'] ?? null,
    }
  } catch {
    return null
  }
}

const SYSTEM_PROMPT = `You are a Senior OSINT Officer specialized in disinformation detection.

When given a URL or a news claim, your job is to:
1. Search for the claim or URL using the tavily_search tool to find corroborating or contradicting sources
2. If infrastructure data is provided in the prompt, analyze it for red flags
3. Return a structured JSON verdict

Your verdict must ALWAYS be valid JSON with this exact shape:
{
  "verdict": "REAL" | "FAKE" | "SUSPICIOUS" | "UNVERIFIABLE",
  "confidence": 0-100,
  "summary": "One paragraph explanation of your finding",
  "sources": ["url1", "url2", "url3", "url4", "url5"],
  "flags": ["list of red flags if any"]
}

Rules:
- If WHOIS data is provided in the prompt: add "Domain registered [ageDays] days ago (since [year])" using exact values. Add "Registrar: [name]" if not null. Add "Registrant country: [country]" if not null. If ageDays < 30 set verdict SUSPICIOUS.
- If VirusTotal data is provided in the prompt: add "VirusTotal: clean — [malicious] malicious, [harmless] harmless votes" using EXACT numbers from the data. Add "Hosting category: [categories]" ONLY if categories list is not empty.
- ABSOLUTE RULE: if no infrastructure data was provided in the prompt, do NOT add any domain, VirusTotal or registrar flags. Never invent infrastructure data.
- ALWAYS scan Tavily result URLs. If any contains: maldita.es, newtral.es, snopes.com, factcheck.org, afpfactcheck.com, politifact.com, verificat.cat, fullfact.org, chequeado.com — add "Fact-checked by: [domain]".
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

    // Run VT + WHOIS in parallel before the agent — guaranteed, no model discretion
    const [vtData, whoisData, geoData] = domain
      ? await Promise.all([
          vtKey ? fetchVirusTotal(domain, vtKey) : Promise.resolve(null),
          fetchWhois(domain),
          getGeoData(domain),
        ])
      : [null, null, null]

    // Build prompt with infra data already injected
    const infraSection = domain && (vtData || whoisData)
      ? `\n\n--- Infrastructure Analysis (use these exact values for flags) ---` +
        (whoisData ? `\nWHOIS data: ${JSON.stringify(whoisData)}` : '') +
        (vtData ? `\nVirusTotal data: ${JSON.stringify(vtData)}` : '') +
        `\n---`
      : ''

    const prompt = domain
      ? `Verify the following: ${input}\n\nExtracted domain: ${domain}${infraSection}`
      : `Verify the following: ${input}\n\nIMPORTANT: This is plain text with no URL. Do NOT add any infrastructure or domain flags.`

    const { text, steps } = await generateText({
      model: groq('llama-3.3-70b-versatile'),
      system: SYSTEM_PROMPT,
      prompt,
      // @ts-ignore
      maxSteps: 5,
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
      geoData: geoData ?? undefined,
    })

  } catch (err) {
    console.error('Agent error:', err)
    return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
  }
}
