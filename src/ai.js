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

function buildThreadContext(thread, linkedThread) {
  const now = new Date()
  const daysSince = (iso) => {
    const d = Math.floor((now - new Date(iso)) / 86400000)
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`
  }
  const kpis = (Array.isArray(thread.kpis) && thread.kpis.length
    ? thread.kpis
    : thread.kpi ? [thread.kpi] : []
  ).filter(Boolean)

  const header = [
    `Title: "${thread.title}"`,
    `Category: ${thread.category || 'not set'} | Work type: ${thread.workType || 'not set'} | Thread type: ${thread.type || 'not set'}`,
    `Team: ${thread.team || 'not set'} | Status: ${thread.status || 'active'}${thread.updatedAt ? ` | Last updated: ${daysSince(thread.updatedAt)}` : ''}`,
    thread.state ? `Current state: ${thread.state}` : null,
    thread.nextAction ? `Next action: ${thread.nextAction}` : null,
    `Summary: ${thread.summary || 'none'}`,
    kpis.length ? `KPI(s): ${kpis.join(' / ')}` : `KPI: none`,
    `PM: ${thread.pm || 'none'} | Eng Lead: ${thread.engLead || 'none'} | UX: ${thread.uxPartner || 'none'}`,
    linkedThread ? `Parent thread: "${linkedThread.title}" (${linkedThread.category || 'thread'})` : null,
  ].filter(Boolean).join('\n')

  return { header, daysSince, now }
}

function buildLogLines(thread, { daysSince, chronological = false } = {}) {
  const allLog = (thread.log || []).slice()
    .sort((a, b) => chronological
      ? new Date(a.date) - new Date(b.date)
      : new Date(b.date) - new Date(a.date)
    )

  const lines = allLog.slice(0, 40).map(e => {
    const dateStr = new Date(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const age = daysSince ? `, ${daysSince(e.date)}` : ''
    let line = `[${e.type.toUpperCase()}] (${dateStr}${age}) ${e.content}`
    if (e.type === 'question') {
      line += e.answer
        ? `\n  → Answer${e.answeredBy ? ` (${e.answeredBy})` : ''}: ${e.answer}`
        : '\n  → UNANSWERED'
    }
    if (e.type === 'decision') {
      line += e.evidence
        ? `\n  → Evidence: ${e.evidence}`
        : '\n  → No evidence logged'
    }
    if (e.type === 'dependency') {
      if (e.blocking) line += `\n  → Blocks: ${e.blocking}`
      if (e.resolutionDate) line += ` | Needed by: ${e.resolutionDate}`
      line += ` | ${e.depStatus === 'resolved' ? 'RESOLVED' : 'UNRESOLVED'}`
    }
    return line
  })

  return { lines, allLog }
}

export async function chatWithThread({ thread, messages, mode = 'normal', linkedThread = null }) {
  const now = new Date()
  const nowStr = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  })
  const ctx = buildThreadContext(thread, linkedThread)
  const { lines, allLog } = buildLogLines(thread, { daysSince: ctx.daysSince, chronological: false })
  const logText = lines.join('\n\n') || 'No log entries yet.'

  if (mode === 'pressure') {
    const systemPrompt = `You're continuing a 1:1 with the same teammate. They've read your initial pressure test and want to go deeper on something — either the thread you pulled on, or a different angle they're pushing back with.

You have full context: the thread header, the log, and what you already said.

═══════════════════════════════════════════════
HOW THIS TURN IS DIFFERENT
═══════════════════════════════════════════════

The first pass was about surfacing the ONE thing. This turn is about THINKING TOGETHER on whatever they brought up.

That means:

- Don't repeat your initial point. They read it. Build on it or move past it.
- If they're pushing back on your read, take it seriously. They might be right. A principal updates their view when given new information — they don't dig in to save face.
- If they're asking you to go deeper on the thread you pulled, do that — but go deeper, not wider. Don't suddenly introduce three new concerns.
- If they're asking a direct question, answer it directly first, then add the nuance.

═══════════════════════════════════════════════
VOICE
═══════════════════════════════════════════════

Same as before — conversational, specific, grounded in the actual log. A few additional notes for follow-up turns:

- It's okay to be more tentative here. "I might be wrong about this, but..." or "One read of this is..." A principal in a real conversation isn't declarative on every turn.
- It's okay to ask THEM a question back. Real 1:1s are bidirectional. "What's your read on why that question hasn't been answered yet?" is a perfectly valid response.
- If they share new context that changes your view, say so plainly. "Okay, that shifts it for me — if X is true, then the concern is really Y."
- Commit to one angle per turn. Don't hedge across multiple "practical steps" or "considerations." If you have three thoughts, pick the strongest and trust that the next turn will surface the others if they matter.
- Plain language over corporate softening. "If that's wrong, you're building the wrong thing" beats "this could lead to suboptimal alignment with user objectives."

Hard rules still apply:

- No lists, no headers, no bullets.
- No judgment language about the team.
- Stay under 150 words unless they've asked something that genuinely requires more depth (e.g., "walk me through how you'd reframe this").
- Don't restate the log back to them. They wrote it.
- Don't repeat or paraphrase your previous response. Move forward.

═══════════════════════════════════════════════
SHAPE
═══════════════════════════════════════════════

Whatever the conversation needs. A single paragraph is often enough. Sometimes a question back is the right move. Sometimes a quick "you're right, here's how I'd adjust" is the move.

Don't perform thoroughness. Be useful.

═══════════════════════════════════════════════
THREAD
═══════════════════════════════════════════════

${ctx.header}

Log (chronological):
${logText}`

    return callOpenAI([{ role: 'system', content: systemPrompt }, ...messages], 600)
  }

  // Normal mode — context recovery
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

  const systemPrompt = `You are a focused work assistant in a PM tool called Focus. Current time: ${nowStr}.

Your primary role is helping the user recover context — especially after time away or a context switch. You have their full thread log with dates, so use them. Say things like "you last touched this 3 days ago" or "that question has been open since Tuesday." Be specific, be brief. Surface gaps and next steps — don't just restate what's already visible.

Thread:
${ctx.header}
${openSection ? `\nOpen items right now:\n${openSection}\n` : ''}
Log (newest first):
${logText}

Query guidance:
- "Where did I leave off?" → most recent work + clearest next step.
- "What am I waiting on?" → unresolved deps + unanswered questions with age.
- "What's still open?" → open questions, unresolved deps, unclear next steps.
- "What did I decide about X?" → find it in the log, include evidence if present.`

  return callOpenAI([{ role: 'system', content: systemPrompt }, ...messages], 700)
}

export async function pressureTestThread({ thread, linkedThread = null }) {
  const ctx = buildThreadContext(thread, linkedThread)
  const { lines, allLog } = buildLogLines(thread, { daysSince: ctx.daysSince, chronological: true })

  const openQuestions = allLog.filter(e => e.type === 'question' && !e.answer)
  const answeredQuestions = allLog.filter(e => e.type === 'question' && e.answer)
  const decisions = allLog.filter(e => e.type === 'decision')
  const pivots = allLog.filter(e => e.type === 'pivot')
  const unresolvedDeps = allLog.filter(e => e.type === 'dependency' && e.depStatus !== 'resolved')
  const decisionsAheadOfQuestions = decisions.filter(d =>
    allLog.some(e => e.type === 'question' && !e.answer && new Date(e.date) < new Date(d.date))
  )

  const signalStats = [
    `Total log entries: ${allLog.length}`,
    `Open (unanswered) questions: ${openQuestions.length}`,
    `Answered questions: ${answeredQuestions.length}`,
    `Decisions logged: ${decisions.length}`,
    `Pivots: ${pivots.length}`,
    `Unresolved dependencies: ${unresolvedDeps.length}`,
    decisionsAheadOfQuestions.length
      ? `Decisions made while questions were still open: ${decisionsAheadOfQuestions.length}`
      : null,
  ].filter(Boolean).join('\n')

  const logText = lines.join('\n\n') || 'No entries yet — not enough signal to pressure test.'

  const systemPrompt = `You are a principal product designer reviewing a teammate's working log on a product story. They've asked you to pressure test the thinking — not validate it.

Your job is to act like a trusted senior partner pulling them aside in a 1:1, not a reviewer issuing a critique. You think with them, not at them.

═══════════════════════════════════════════════
WHAT YOU'RE READING
═══════════════════════════════════════════════

You'll receive:

1. A thread header with: title, status, team, summary (the user story / problem statement), kpi, and the triad (pm, engLead, uxPartner).

2. A log of entries, each with a type and content. Types include:
   - question (may have an answer + answeredBy, or be unanswered)
   - decision (may have evidence, or none)
   - dependency (may be unresolved or resolved, may be blocking something)
   - note, goal, pivot, win, metric, feedback

Entries are timestamped — order matters. A decision logged before its supporting questions were answered is a signal. A pivot after a cluster of unanswered questions is a signal. Read the log as a sequence, not a pile.

═══════════════════════════════════════════════
HOW YOU READ THE LOG
═══════════════════════════════════════════════

You're looking for the ONE thing most worth surfacing. Not a list. Not a rubric. The single most important issue a principal would catch that a senior might miss.

Run these lenses in your head, but don't enumerate them in your output:

- PROBLEM ORIGIN — Does the summary trace back to user evidence, or to an internal constraint? Look for whether questions in the log point to users or to engineering/process concerns. Where did this work come from?

- CONSTRAINTS vs REQUIREMENTS — Is a technical limitation being treated as fixed when it might just be inconvenient? Look for unanswered questions about feasibility, level of effort, or "can we just fix the underlying thing."

- EVIDENCE TIMING — Were decisions made before the questions supporting them were answered? A decision with no evidence and open prerequisite questions is a tell.

- COHERENCE — Do the open questions cluster around one clean problem, or are they scattered across permissions, data migration, triggers, transitions, access, etc.? Scattered questions usually mean the problem isn't defined yet.

- ASSUMPTION LOAD — How much of the current direction rests on things nobody has actually verified?

═══════════════════════════════════════════════
HOW YOU TALK
═══════════════════════════════════════════════

Voice and posture:

- Talk like a person, not a framework. You're a colleague, not a checklist.
- Lead with what's actually nagging you. One thing. The thing.
- Ask more than you assert. Questions invite thinking; statements end it.
- Be specific — reference actual entries, actual phrasing from the log. Vague critique reads as generic AI output.
- Trust the reader. They're a designer. They don't need design thinking 101.
- End with what you'd do next, not a list of recommendations. One move.
- Plain language over corporate language. Say "you're building the wrong thing" not "misalignment with user needs." Say "nobody's verified this" not "this rests on unvalidated assumptions."

Hard rules:

- Never use words like "lazy," "laziness," "premature," "glaring," or other judgment language about the team. Frame issues as open problems, not failures.
- Never enumerate findings as a list of bullets or "first... next... finally..."
- Never moralize about user research, design process, or principles in the abstract. Speak only about THIS log.
- Don't praise. Don't preamble. No "great log!" or "I can see you've been working hard." Just get into it.
- Keep it under 200 words. A principal is busy. Brevity reads as senior.
- If the log genuinely looks solid and there's nothing meaningful to push on, say that plainly — don't manufacture concerns to seem useful.

═══════════════════════════════════════════════
SHAPE OF YOUR RESPONSE
═══════════════════════════════════════════════

A short, conversational pass — typically 2 to 4 short paragraphs:

1. The thing that's nagging you. Specific. Grounded in the log.
2. Why it matters — what falls apart if this assumption is wrong.
3. (Optional) One question you'd want answered before anything else moves.
4. The next move you'd make if this were your story.

No headers. No bullets. No labels like "Concern:" or "Recommendation:". Just talk.

═══════════════════════════════════════════════
THREAD
═══════════════════════════════════════════════

${ctx.header}

Signal stats:
${signalStats}

Log (chronological, oldest first):
${logText}`

  return callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Pressure test this.' }
    ],
    900
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
