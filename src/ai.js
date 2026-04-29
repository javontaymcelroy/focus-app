const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const MODEL = 'gpt-4o'
const STORAGE_KEY = 'focus_openai_api_key'

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || ''
}

export function setApiKey(key) {
  localStorage.setItem(STORAGE_KEY, key)
}

async function callOpenAI(messages, maxTokens = 256) {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not set. Add it in Settings (gear icon).')
  }

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_completion_tokens: maxTokens,
      temperature: 0.7
    })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err.error?.message || `OpenAI API error (${res.status})`
    console.error('OpenAI API error:', err)
    throw new Error(msg)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

export async function generateKPI({ title, summary, linkedThread, metricLogs }) {
  const parts = [`Thread title: "${title}"`]
  if (summary) parts.push(`Summary: "${summary}"`)
  if (linkedThread) {
    parts.push(`Parent thread: "${linkedThread.title}"`)
    if (linkedThread.summary) parts.push(`Parent summary: "${linkedThread.summary}"`)
    if (linkedThread.kpi) parts.push(`Parent KPI: "${linkedThread.kpi}"`)
  }
  if (metricLogs && metricLogs.length > 0) {
    parts.push(`\nCaptured metric logs from this thread:`)
    metricLogs.forEach(m => parts.push(`- [${m.createdAt?.slice(0, 10) || 'unknown'}] ${m.content}`))
  }

  const messages = [
    {
      role: 'system',
      content: `You write KPIs for performance reviews and impact tracking — not product marketing.

Given thread context (and any captured metric logs), generate a single KPI that measures real outcome or, if outcome data isn't available yet, the strongest leading signal of value.

Prioritize in this order:
1. Outcome metrics — measurable change in user behavior, efficiency, or business result (e.g. "Reduce time-to-complete review task from 12 min to under 5 min")
2. Leading signals — adoption or usage patterns that predict value (e.g. "% of users using at least 1 manipulation feature per session" or "avg sort/filter/search interactions per session")
3. Reduction metrics — eliminated workarounds, manual steps, or support burden (e.g. "Reduce manual CSV exports by 80%")

Never use soft engagement words like "increase engagement" or "improve satisfaction" without a concrete measure.

If metric logs exist, anchor the KPI to those real numbers.

Output ONLY the KPI string — no quotes, no explanation, no preamble.`
    },
    {
      role: 'user',
      content: parts.join('\n')
    }
  ]

  return callOpenAI(messages, 120)
}

export async function chatWithThread({ thread, messages }) {
  const logSummary = (thread.log || [])
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30)
    .map(e => `[${e.type.toUpperCase()}] ${e.content}${e.answer ? ` → Answer: ${e.answer}` : ''}`)
    .join('\n')

  const systemPrompt = `You are a focused, concise work assistant embedded in a PM tool called Focus. You have full context on a specific work thread and help the user think through it — answering questions, surfacing patterns in the log, identifying blockers, and suggesting next steps.

Thread context:
- Title: "${thread.title}"
- Team: ${thread.team || 'not set'}
- Status: ${thread.status || 'active'}
- Current state: ${thread.state || 'not set'}
- Next action: ${thread.nextAction || 'not set'}
- Summary: ${thread.summary || 'none'}
- KPI: ${thread.kpi || 'none'}
- PM: ${thread.pm || 'none'} | Eng Lead: ${thread.engLead || 'none'} | UX: ${thread.uxPartner || 'none'}

Thread log (most recent first):
${logSummary || 'No log entries yet.'}

Be direct and brief. Don't repeat information the user can already see. Focus on insight, not summary.`

  return callOpenAI(
    [{ role: 'system', content: systemPrompt }, ...messages],
    600
  )
}

export async function improveSummary({ title, summary, linkedThread }) {
  const parts = [`Thread title: "${title}"`]
  if (linkedThread) {
    parts.push(`Parent thread: "${linkedThread.title}"`)
  }
  parts.push(`Current summary: "${summary}"`)

  const messages = [
    {
      role: 'system',
      content: `You are a light-touch editor. Your job is to improve the clarity, grammar, spelling, and wording of an existing summary — NOT to restructure, reframe, or rewrite it.

Rules:
- Preserve all specific facts, details, product names, and technical descriptions exactly as stated
- Do NOT add claims, framing, or context that the original does not contain
- Do NOT remove specific details to make it shorter or "punchier"
- Do NOT restructure the flow unless the original is genuinely confusing
- Do NOT replace concrete language with vague abstractions (e.g. don't turn "live editable table with citations" into "shared workspace")
- Fix grammar, spelling, awkward phrasing, and redundancy
- Tighten wordiness where possible without losing specifics
- Keep approximately the same length — if the original is 2 paragraphs, the output should be too
- Use direct, active voice where it improves clarity

The goal is: same content, same details, same structure — just cleaner prose.

Output ONLY the improved summary — no quotes, no explanation, no preamble.`
    },
    {
      role: 'user',
      content: parts.join('\n')
    }
  ]

  return callOpenAI(messages, 200)
}
