import { groq } from '@ai-sdk/groq'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'

function extractDomain(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.hostname.replace(/^www\./, '')
  } catch {
    return null
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
- If a domain is younger than 30 days, set verdict to SUSPICIOUS and add "Domain registered less than 30 days ago" to flags
- If VirusTotal reports malicious or suspicious votes > 0, add "Domain flagged by VirusTotal" to flags
- If multiple credible sources corroborate the claim, lean toward REAL
- If no sources found at all, return UNVERIFIABLE
- Always use the search tool before making a verdict — never guess
- Include ALL relevant sources found in the sources array — minimum 3 when available, up to 8. Never truncate sources.
- CRITICAL: You MUST respond in the exact same language as the input. If the input is in Spanish, the entire summary must be in Spanish. If in English, in English and so on. Never switch languages.
- Return ONLY the JSON object, no markdown, no preamble`

export async function POST(req: NextRequest) {
  try {
    const { input } = await req.json()

    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 })
    }

    const domain = extractDomain(input)
    const prompt = domain
      ? `Verify the following: ${input}\n\nExtracted domain for infrastructure checks: ${domain}`
      : `Verify the following: ${input}`

    const result = await generateText({
      model: groq('llama-3.3-70b-versatile'),
      system: SYSTEM_PROMPT,
      prompt,
      maxSteps: 7,
      tools: {
        tavily_search: tool({
          description: 'Search the web for real-time information to verify claims or investigate URLs.',
          parameters: z.object({
            query: z.string().describe('The search query to investigate'),
          }),
          execute: async ({ query }) => {
            const res = await fetch('https://api.tavily.com/search', {
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
          },
        }),

        virustotal_check: tool({
          description: 'Check a domain\'s reputation and malware history via VirusTotal.',
          parameters: z.object({
            domain: z.string().describe('The domain to check, e.g. "suspicious-news.net"'),
          }),
          execute: async ({ domain }) => {
            const res = await fetch(
              `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`,
              { headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY ?? '' } }
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
          },
        }),

        whois_lookup: tool({
          description: 'Look up domain registration data via RDAP to detect freshly registered fake news outlets.',
          parameters: z.object({
            domain: z.string().describe('The domain to look up, e.g. "suspicious-news.net"'),
          }),
          execute: async ({ domain }) => {
            const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`)
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
          },
        }),
      },
    })

    const candidateTexts: string[] = [
      result.text,
      ...result.steps.map((s) => s.text ?? ''),
      ...result.steps.flatMap((s) =>
        s.response?.messages?.map((m) => {
          if (typeof m.content === 'string') return m.content
          if (Array.isArray(m.content)) {
            return m.content
              .filter((c: { type: string; text?: string }) => c.type === 'text')
              .map((c: { type: string; text?: string }) => c.text ?? '')
              .join('')
          }
          return ''
        }) ?? []
      ),
    ].filter(Boolean)

    let verdict
    let parsed = false

    for (const candidate of candidateTexts) {
      try {
        const jsonMatch = candidate.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          verdict = JSON.parse(jsonMatch[0])
          if (verdict.verdict && verdict.summary) {
            parsed = true
            break
          }
        }
      } catch {
        // continue
      }
    }

    if (!parsed) {
      verdict = {
        verdict: 'UNVERIFIABLE',
        confidence: 0,
        summary: result.text || 'Agent returned no structured text',
        sources: [],
        flags: ['Agent response was not valid JSON or properties were missing'],
      }
    }

    return NextResponse.json({
      verdict,
      steps: result.steps.length,
      infraChecked: domain !== null,
      domain: domain ?? undefined,
    })

  } catch (err) {
    console.error('Agent error:', err)
    return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
  }
}
