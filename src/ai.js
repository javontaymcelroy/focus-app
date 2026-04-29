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
  const now = new Date()
  const nowStr = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  })

  const daysSince = (iso) => {
    const d = Math.floor((now - new Date(iso)) / 86400000)
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`
  }

  const allLog = (thread.log || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date))

  const logLines = allLog.slice(0, 40).map(e => {
    const dateStr = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    let line = `[${e.type.toUpperCase()}] (${dateStr}, ${daysSince(e.date)}) ${e.content}`
    if (e.type === 'question') {
      line += e.answer
        ? ` → Answered${e.answeredBy ? ` by ${e.answeredBy}` : ''}: ${e.answer}`
        : ' → UNANSWERED'
    }
    if (e.type === 'decision' && e.evidence) line += ` → Evidence: ${e.evidence}`
    if (e.type === 'dependency') {
      if (e.blocking) line += ` | Blocks: ${e.blocking}`
      if (e.resolutionDate) line += ` | Needed by: ${e.resolutionDate}`
      line += ` | ${e.depStatus === 'resolved' ? 'RESOLVED' : 'UNRESOLVED'}`
    }
    return line
  }).join('\n')

  const openQuestions = allLog.filter(e => e.type === 'question' && !e.answer)
  const unresolvedDeps = allLog.filter(e => e.type === 'dependency' && e.depStatus !== 'resolved')

  const openSection = [
    openQuestions.length
      ? `Open questions (${openQuestions.length}):\n${openQuestions.map(q => `  - ${q.content}`).join('\n')}`
      : null,
    unresolvedDeps.length
      ? `Unresolved dependencies (${unresolvedDeps.length}):\n${unresolvedDeps.map(d => `  - ${d.content}${d.blocking ? ` (blocks: ${d.blocking})` : ''}${d.resolutionDate ? ` (needed by: ${d.resolutionDate})` : ''}`).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n')

  const lastUpdated = thread.updatedAt ? daysSince(thread.updatedAt) : 'unknown'

  const systemPrompt = `You are a focused work assistant in a PM tool called Focus. Current time: ${nowStr}.

Your primary role is helping the user recover context — especially after time away or a context switch. You have their full thread log with dates, so use them. Say things like "you last touched this 3 days ago" or "that question has been open since Tuesday." Be specific, be brief. Surface gaps and next steps — don't just restate what's already visible.

Thread:
- Title: "${thread.title}"
- Team: ${thread.team || 'not set'} | Status: ${thread.status || 'active'} | Last updated: ${lastUpdated}
- Summary: ${thread.summary || 'none'}
- KPI: ${thread.kpi || 'none'}
- PM: ${thread.pm || 'none'} | Eng Lead: ${thread.engLead || 'none'} | UX: ${thread.uxPartner || 'none'}
${openSection ? `\nOpen items right now:\n${openSection}\n` : ''}
Log (newest first, up to 40 entries):
${logLines || 'No log entries yet.'}

Query guidance:
- "Where did I leave off?" → most recent work + clearest next step.
- "What am I waiting on?" → unresolved deps + unanswered questions with age.
- "What's still open?" → open questions, unresolved deps, unclear next steps.
- "What did I decide about X?" → find it in the log, include evidence if present.`

  return callOpenAI(
    [{ role: 'system', content: systemPrompt }, ...messages],
    700
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
