import React, { useState, useEffect, useRef, useCallback } from 'react'
import { generateKPI, improveSummary, getApiKey } from '../ai'
import { getPersistedSize, persistSize } from '../persist'

const LOG_TYPES = ['decision', 'note', 'question', 'win', 'metric', 'feedback', 'goal']
const CATEGORIES = [
  { value: '', label: 'None' },
  { value: 'project', label: 'Project' },
  { value: 'epic', label: 'Epic' },
  { value: 'story', label: 'Story' },
  { value: 'feature', label: 'Feature' },
  { value: 'design-qa', label: 'Design QA' },
]

const CATEGORY_LABELS = {
  project: 'Project',
  epic: 'Epic',
  story: 'Story',
  feature: 'Feature',
  'design-qa': 'Design QA',
}

const WORK_TYPES = [
  { value: '', label: 'None' },
  { value: 'exploration', label: 'Exploration' },
  { value: 'competitive-research', label: 'Competitive Market Research' },
  { value: 'r-and-d', label: 'R&D' },
  { value: 'claude-prototyping', label: 'Claude Prototyping' },
  { value: 'alignment', label: 'Alignment' },
  { value: 'user-research', label: 'User Research' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'bug-fix', label: 'Bug Fix' },
  { value: 'design', label: 'Design' },
]

const WORK_TYPE_LABELS = {
  'exploration': 'Exploration',
  'competitive-research': 'Competitive Research',
  'r-and-d': 'R&D',
  'claude-prototyping': 'Claude Prototyping',
  'alignment': 'Alignment',
  'user-research': 'User Research',
  'documentation': 'Documentation',
  'implementation': 'Implementation',
  'bug-fix': 'Bug Fix',
  'design': 'Design',
}

function PeopleSelect({ label, value, options, onChange, placeholder }) {
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const allOptions = value && !options.includes(value)
    ? [value, ...options]
    : options

  if (isAdding) {
    return (
      <div className="detail-field">
        <div className="detail-field-label">{label}</div>
        <div className="people-add-row">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={placeholder}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) {
                e.preventDefault()
                onChange(newName.trim())
                setIsAdding(false)
                setNewName('')
              }
              if (e.key === 'Escape') {
                setIsAdding(false)
                setNewName('')
              }
            }}
          />
          <button
            type="button"
            className="people-add-confirm"
            onClick={() => {
              if (newName.trim()) {
                onChange(newName.trim())
                setIsAdding(false)
                setNewName('')
              }
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="people-add-cancel"
            onClick={() => { setIsAdding(false); setNewName('') }}
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <select
        value={value || ''}
        onChange={e => {
          if (e.target.value === '__add_new__') {
            setIsAdding(true)
          } else {
            onChange(e.target.value)
          }
        }}
      >
        <option value="">None</option>
        {allOptions.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
        <option value="__add_new__">+ Add new...</option>
      </select>
    </div>
  )
}

// Category hierarchy: story → epic → project
const LINK_TARGETS = {
  'story': 'epic',
  'feature': 'epic',
  'design-qa': 'epic',
  'epic': 'project',
}

export default function ThreadDetail({
  thread,
  onClose,
  onUpdate,
  onEvolve,
  onAddLog,
  onDeleteLog,
  onEditLog,
  onDemote,
  onDelete,
  onStatusChange,
  isFocus,
  teams = [],
  people = { pms: [], engLeads: [], uxPartners: [] },
  allThreads = [],
  onBackToProject = null,
  navStack = [],
  allNavThreads = [],
  onBreadcrumbNav,
  panelWidth,
  onResizeStart,
  navAction = 'open',
  closing = false
}) {
  const [mode, setMode] = useState('view') // 'view' or 'edit'
  const [title, setTitle] = useState(thread.title)
  const [state, setState] = useState(thread.state)
  const [nextAction, setNextAction] = useState(thread.nextAction)
  const [resumeLink, setResumeLink] = useState(thread.resumeLink)
  const [type, setType] = useState(thread.type)
  const [team, setTeam] = useState(thread.team || '')
  const [category, setCategory] = useState(thread.category || '')
  const [workType, setWorkType] = useState(thread.workType || '')
  const [summary, setSummary] = useState(thread.summary || '')
  const [kpis, setKpis] = useState(() => {
    if (Array.isArray(thread.kpis) && thread.kpis.length) return thread.kpis
    if (thread.kpi) return [thread.kpi]
    return ['']
  })
  const [pm, setPm] = useState(thread.pm || '')
  const [engLead, setEngLead] = useState(thread.engLead || '')
  const [uxPartner, setUxPartner] = useState(thread.uxPartner || '')
  const [status, setStatus] = useState(thread.status)
  const [linkedTo, setLinkedTo] = useState(thread.linkedTo || '')
  const [logType, setLogType] = useState('decision')
  const [logContent, setLogContent] = useState('')
  const [editingLogId, setEditingLogId] = useState(null)
  const [editLogType, setEditLogType] = useState('')
  const [editLogContent, setEditLogContent] = useState('')
  const [editingLogDate, setEditingLogDate] = useState(null) // log entry id being date-edited
  const [logFilter, setLogFilter] = useState(null) // null = all, or a log type string
  const [isAddingTeam, setIsAddingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [pushToFocus, setPushToFocus] = useState(thread.pushToFocus || '')
  const [droppedReason, setDroppedReason] = useState('')
  const [aiLoadingKpi, setAiLoadingKpi] = useState(false)
  const [aiLoadingSummary, setAiLoadingSummary] = useState(false)
  const [aiError, setAiError] = useState(null)

  // Persist textarea resize heights across reloads
  const observersRef = useRef({})
  const textareaRef = useCallback((key) => (el) => {
    if (!el) return
    const saved = getPersistedSize(`textarea-${key}`)
    if (saved) el.style.height = `${saved}px`
    if (observersRef.current[key]) observersRef.current[key].disconnect()
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        persistSize(`textarea-${key}`, Math.round(entry.contentRect.height + 26))
      }
    })
    ro.observe(el)
    observersRef.current[key] = ro
  }, [])

  useEffect(() => {
    return () => {
      Object.values(observersRef.current).forEach(ro => ro.disconnect())
    }
  }, [])

  // Only sync from prop when switching to a different thread
  const [prevThreadId, setPrevThreadId] = useState(thread.id)
  useEffect(() => {
    if (thread.id !== prevThreadId) {
      setTitle(thread.title)
      setState(thread.state)
      setNextAction(thread.nextAction)
      setTeam(thread.team || '')
      setCategory(thread.category || '')
      setWorkType(thread.workType || '')
      setSummary(thread.summary || '')
      setKpis(Array.isArray(thread.kpis) && thread.kpis.length ? thread.kpis : thread.kpi ? [thread.kpi] : [''])
      setPm(thread.pm || '')
      setEngLead(thread.engLead || '')
      setUxPartner(thread.uxPartner || '')
      setLinkedTo(thread.linkedTo || '')
      setResumeLink(thread.resumeLink)
      setType(thread.type)
      setStatus(thread.status)
      setPushToFocus(thread.pushToFocus || '')
      setDroppedReason('')
      setMode('view')
      setPrevThreadId(thread.id)
    }
  }, [thread.id, prevThreadId])

  // Local-only change handlers — nothing saves until "Done editing"
  const handleTitleChange = (e) => setTitle(e.target.value)
  const handleResumeLinkChange = (e) => setResumeLink(e.target.value)
  const handleTeamChange = (e) => setTeam(e.target.value)
  const handleSummaryChange = (e) => setSummary(e.target.value)
  const handleKpiChange = (index, value) => {
    const updated = [...kpis]
    updated[index] = value
    setKpis(updated)
  }
  const handleAddKpi = () => {
    if (kpis.length < 4) setKpis([...kpis, ''])
  }
  const handleRemoveKpi = (index) => {
    const updated = kpis.filter((_, i) => i !== index)
    setKpis(updated.length ? updated : [''])
  }
  const handleCategoryChange = (e) => setCategory(e.target.value)
  const handleWorkTypeChange = (e) => setWorkType(e.target.value)
  const handleTypeChange = (e) => setType(e.target.value)
  const handleStatusChange = (e) => {
    const newStatus = e.target.value
    setStatus(newStatus)
    if (newStatus !== 'blocked' && newStatus !== 'review') {
      setPushToFocus('')
    }
    if (newStatus !== 'dropped') {
      setDroppedReason('')
    }
  }
  const handleStateChange = (e) => setState(e.target.value)
  const handleNextActionChange = (e) => setNextAction(e.target.value)
  const handleDropThread = () => {
    if (!droppedReason.trim()) return
    onAddLog({ type: 'decision', content: `Dropped: ${droppedReason.trim()}` })
    setDroppedReason('')
  }

  const handleSnapshot = () => {
    if (!state && !nextAction) return
    onEvolve({ state, nextAction })
  }

  const handlePmChange = (value) => setPm(value)
  const handleEngLeadChange = (value) => setEngLead(value)
  const handleUxPartnerChange = (value) => setUxPartner(value)
  const handleLinkedToChange = (e) => setLinkedTo(e.target.value)

  // Save all changes at once
  const handleSaveAll = () => {
    const updates = {
      title, state, nextAction, resumeLink, type, team,
      category, workType, summary, kpis: kpis.filter(k => k.trim()), kpi: kpis.filter(k => k.trim())[0] || '', pm, engLead, uxPartner,
      linkedTo: linkedTo || null,
      pushToFocus: pushToFocus || null,
      status,
    }
    onUpdate(updates)
    if (status !== thread.status) {
      onStatusChange(status)
    }
    setMode('view')
  }

  const handleCancel = () => {
    // Discard changes — reset to thread values
    setTitle(thread.title); setState(thread.state); setNextAction(thread.nextAction)
    setResumeLink(thread.resumeLink); setType(thread.type); setTeam(thread.team || '')
    setCategory(thread.category || ''); setWorkType(thread.workType || '')
    setSummary(thread.summary || ''); setKpis(initKpis(thread))
    setPm(thread.pm || ''); setEngLead(thread.engLead || ''); setUxPartner(thread.uxPartner || '')
    setLinkedTo(thread.linkedTo || ''); setStatus(thread.status)
    setPushToFocus(thread.pushToFocus || '')
    setMode('view')
  }

  const parentCategory = LINK_TARGETS[category]
  const otherThreads = allThreads.filter(t => t.id !== thread.id)
  const suggestedThreads = parentCategory
    ? otherThreads.filter(t => t.category === parentCategory)
    : []
  const remainingThreads = otherThreads.filter(t => !suggestedThreads.includes(t))
  const linkedThread = allThreads.find(t => t.id === linkedTo)

  // Group remaining threads by category, projects first
  const CATEGORY_ORDER = ['project', 'epic', 'story', 'feature', 'design-qa', '']
  const groupedRemaining = CATEGORY_ORDER.reduce((acc, cat) => {
    const threads = remainingThreads.filter(t => (t.category || '') === cat)
    if (threads.length > 0) acc.push({ category: cat, threads })
    return acc
  }, [])
  // Catch any categories not in the predefined order
  const knownCats = new Set(CATEGORY_ORDER)
  const extraGroups = remainingThreads
    .filter(t => !knownCats.has(t.category || ''))
    .reduce((acc, t) => {
      const cat = t.category || ''
      if (!acc.find(g => g.category === cat)) acc.push({ category: cat, threads: [] })
      acc.find(g => g.category === cat).threads.push(t)
      return acc
    }, [])
  const allGroups = [...groupedRemaining, ...extraGroups]

  const handleFillKpi = async () => {
    if (!getApiKey()) {
      setAiError('OpenAI API key not set. Add it in Settings (gear icon in header).')
      return
    }
    setAiLoadingKpi(true)
    setAiError(null)
    try {
      const metricLogs = (thread.log || []).filter(l => l.type === 'metric')
      const result = await generateKPI({ title, summary, linkedThread, metricLogs })
      const updated = [...kpis]
      const emptyIndex = updated.findIndex(k => !k.trim())
      if (emptyIndex >= 0) {
        updated[emptyIndex] = result
      } else if (updated.length < 4) {
        updated.push(result)
      } else {
        updated[0] = result
      }
      setKpis(updated)
    } catch (err) {
      console.error('AI KPI generation failed:', err)
      setAiError(err.message)
    } finally {
      setAiLoadingKpi(false)
    }
  }

  const handleImproveSummary = async () => {
    if (!summary.trim()) {
      setAiError('Enter a summary first, then improve it with AI.')
      return
    }
    if (!getApiKey()) {
      setAiError('OpenAI API key not set. Add it in Settings (gear icon in header).')
      return
    }
    setAiLoadingSummary(true)
    setAiError(null)
    try {
      const result = await improveSummary({ title, summary, linkedThread })
      setSummary(result)
    } catch (err) {
      console.error('AI summary improvement failed:', err)
      setAiError(err.message)
    } finally {
      setAiLoadingSummary(false)
    }
  }

  const handleAddLog = (e) => {
    e.preventDefault()
    if (!logContent.trim()) return
    onAddLog({ type: logType, content: logContent.trim() })
    setLogContent('')
  }

  const handleStartEditLog = (entry) => {
    setEditingLogId(entry.id)
    setEditLogType(entry.type)
    setEditLogContent(entry.content)
  }

  const handleSaveEditLog = () => {
    if (!editLogContent.trim()) return
    onEditLog(editingLogId, { type: editLogType, content: editLogContent.trim() })
    setEditingLogId(null)
  }

  const handleCancelEditLog = () => {
    setEditingLogId(null)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (mode === 'edit') {
        handleCancel()
      } else {
        onClose()
      }
    }
  }

  const formatTime = (iso) => {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit'
    })
  }

  const getDayLabel = (iso) => {
    const date = new Date(iso)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const entryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (entryDay.getTime() === today.getTime()) return 'Today'
    if (entryDay.getTime() === yesterday.getTime()) return 'Yesterday'
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const groupLogByDay = (log) => {
    const sorted = [...log].sort((a, b) => new Date(b.date) - new Date(a.date))
    const groups = []
    let currentLabel = null
    for (const entry of sorted) {
      const label = getDayLabel(entry.date)
      if (label !== currentLabel) {
        groups.push({ label, entries: [] })
        currentLabel = label
      }
      groups[groups.length - 1].entries.push(entry)
    }
    return groups
  }

  // ---------- VIEW MODE ----------
  const renderViewMode = () => (
    <div className="detail-scroll">
      {/* Info card */}
      <div className="detail-view-card" onClick={() => setMode('edit')} style={{ cursor: 'pointer' }}>
        <div className="detail-view-top">
          <div className="detail-view-context">
            {team && <span className="thread-team-label">{team}</span>}
            {category && (
              <span className={`thread-category-label category-${category}`}>
                {CATEGORY_LABELS[category] || category}
              </span>
            )}
            {workType && (
              <span className={`thread-worktype-label worktype-${workType}`}>
                {WORK_TYPE_LABELS[workType] || workType}
              </span>
            )}
          </div>
          {resumeLink && (
            <a
              className="thread-card-resume"
              href={resumeLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
            >
              Resume ↗
            </a>
          )}
        </div>

        {/* Parent breadcrumb */}
        {linkedThread && (
          <div className="thread-card-parent">
            <span className={`thread-card-parent-badge category-${linkedThread.category || 'project'}`}>
              {CATEGORY_LABELS[linkedThread.category] || 'Parent'}
            </span>
            <span className="thread-card-parent-title">{linkedThread.title}</span>
          </div>
        )}

        <div className="detail-view-title">{title}</div>

        {summary && (
          <div className="detail-view-summary">{summary}</div>
        )}

        {kpis.filter(k => k.trim()).map((k, i) => (
          <div className="thread-card-kpi" key={i}>
            <span className="kpi-icon">◎</span>
            {k}
          </div>
        ))}

        {state && (
          <div className="detail-view-state">{state}</div>
        )}

        {(pm || engLead || uxPartner) && (
          <div className="thread-card-people">
            {pm && <span>PM: {pm}</span>}
            {pm && engLead && <span className="people-sep">·</span>}
            {engLead && <span>Eng: {engLead}</span>}
            {(pm || engLead) && uxPartner && <span className="people-sep">·</span>}
            {uxPartner && <span>UX: {uxPartner}</span>}
          </div>
        )}

        {nextAction && (
          <div className="detail-view-next">
            <span className="thread-card-next-arrow">→</span>
            <svg className="thread-card-next-shoe" viewBox="0 0 800 800" fill="currentColor"><path d="M723.605 329.74C737.916 349.775 733.359 377.856 713.445 392.339L243.389 734.198C235.427 739.99 226.015 743.049 216.168 743.049H97.0789C81.071 743.049 68.0498 730.026 68.0496 714.021C68.0496 707.072 73.6828 701.439 80.6317 701.439H185.889C190.657 701.439 195.306 699.952 199.193 697.191L717.079 328.647C719.183 327.149 722.103 327.639 723.605 329.74Z"/><path d="M672.087 257.622C684.3 274.72 680.318 298.486 663.197 310.669L188.452 648.514C182.018 653.093 174.317 655.553 166.42 655.553H106.05C85.0628 655.553 68.0496 638.54 68.0496 617.553V612.38C68.0496 599.327 76.3703 587.782 88.7527 583.656L175.02 554.899C197.194 547.505 215.164 531.919 225.615 511.017C229.74 502.765 240.737 500.98 247.259 507.504L256.981 517.226C262.253 522.495 269.16 525.131 276.066 525.131C282.972 525.131 289.879 522.494 295.15 517.226C305.69 506.686 305.69 489.598 295.15 479.055L270.063 453.966C263.723 447.625 262.151 437.938 266.161 429.918C272.52 417.199 289.471 414.448 299.526 424.503L324.615 449.592C329.886 454.861 336.794 457.497 343.7 457.497C350.609 457.497 357.513 454.861 362.784 449.592C373.324 439.052 373.324 421.961 362.784 411.421L308.312 356.949C306.055 354.692 305.495 351.243 306.924 348.388C313.332 335.572 316.718 321.226 316.718 306.899C316.718 306.433 317.28 306.2 317.609 306.529L342.256 331.176C347.527 336.445 354.433 339.081 361.34 339.081C368.246 339.081 375.152 336.445 380.424 331.176C390.964 320.636 390.964 303.545 380.424 293.005L327.844 240.423C320.718 233.297 316.715 223.632 316.715 213.554V167.494C316.715 151.956 326.175 137.983 340.602 132.212L501.053 68.0302C517.312 61.5266 535.91 66.9756 546.088 81.225L672.087 257.622Z"/></svg>
            {nextAction}
          </div>
        )}

        <div className="detail-view-badges">
          {type === 'persistent' && (
            <span className="badge badge-persistent">Persistent</span>
          )}
          {type === 'weekly' && (
            <span className="badge badge-weekly">Weekly</span>
          )}
          {status === 'review' && (
            <span className="badge badge-review">In Review</span>
          )}
          {status === 'active' && (
            <span className="badge badge-active">Active</span>
          )}
          {status === 'blocked' && (
            <span className="badge badge-blocked">Blocked</span>
          )}
          {status === 'completed' && (
            <span className="badge" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}>Completed</span>
          )}
          {status === 'dropped' && (
            <span className="badge badge-dropped">Dropped</span>
          )}
          {pushToFocus && (status === 'blocked' || status === 'review') && (
            <span className="push-to-focus-hint">
              Push to Focus: {new Date(pushToFocus).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Log Section — always visible in view mode */}
      <div className="log-section">
        <div className="log-section-header">
          <span className="log-section-title">
            Thread Log ({thread.log?.length || 0})
          </span>
        </div>

        <form className="log-add-form" onSubmit={handleAddLog}>
          <div className="log-add-top">
            <select value={logType} onChange={e => setLogType(e.target.value)}>
              {LOG_TYPES.map(t => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            <input
              value={logContent}
              onChange={e => setLogContent(e.target.value)}
              placeholder="Add an entry..."
            />
          </div>
          <button type="submit" className="log-add-btn">Add Entry</button>
        </form>

        {thread.log?.length > 0 && (
          <div className="log-filter-bar">
            <button
              className={`log-filter-chip${logFilter === null ? ' active' : ''}`}
              onClick={() => setLogFilter(null)}
            >All</button>
            {[...new Set(thread.log.map(e => e.type))].map(t => (
              <button
                key={t}
                className={`log-filter-chip${logFilter === t ? ' active' : ''}`}
                onClick={() => setLogFilter(logFilter === t ? null : t)}
              >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        )}

        <div className="log-timeline">
          {thread.log?.length > 0 ? (
            groupLogByDay(logFilter ? thread.log.filter(e => e.type === logFilter) : thread.log).map(group => (
              <div key={group.label} className="log-day-group">
                <div className="log-day-header">
                  <span className="log-day-label">{group.label}</span>
                  <span className="log-day-line" />
                </div>
                <div className="log-day-entries">
                  {group.entries.map(entry => (
                    <div key={entry.id} className={`log-entry ${entry.type === 'progress' ? 'log-entry-progress' : ''}`}>
                      {editingLogId === entry.id ? (
                        <div className="log-edit-form">
                          <div className="log-edit-top">
                            <select value={editLogType} onChange={e => setEditLogType(e.target.value)}>
                              {LOG_TYPES.map(t => (
                                <option key={t} value={t}>
                                  {t.charAt(0).toUpperCase() + t.slice(1)}
                                </option>
                              ))}
                              {!LOG_TYPES.includes(editLogType) && (
                                <option value={editLogType}>
                                  {editLogType.charAt(0).toUpperCase() + editLogType.slice(1)}
                                </option>
                              )}
                            </select>
                            <input
                              autoFocus
                              value={editLogContent}
                              onChange={e => setEditLogContent(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); handleSaveEditLog() }
                                if (e.key === 'Escape') handleCancelEditLog()
                              }}
                            />
                          </div>
                          <div className="log-edit-actions">
                            <button className="log-edit-save" onClick={handleSaveEditLog}>Save</button>
                            <button className="log-edit-cancel" onClick={handleCancelEditLog}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="log-entry-main">
                            {editingLogDate === entry.id ? (
                              <input
                                type="datetime-local"
                                className="log-entry-time-edit"
                                defaultValue={new Date(entry.date).toISOString().slice(0, 16)}
                                autoFocus
                                onBlur={e => {
                                  if (e.target.value) {
                                    onEditLog(entry.id, { date: new Date(e.target.value).toISOString() })
                                  }
                                  setEditingLogDate(null)
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    if (e.target.value) {
                                      onEditLog(entry.id, { date: new Date(e.target.value).toISOString() })
                                    }
                                    setEditingLogDate(null)
                                  }
                                  if (e.key === 'Escape') setEditingLogDate(null)
                                }}
                              />
                            ) : (
                              <span className="log-entry-time" onClick={() => setEditingLogDate(entry.id)} title="Click to edit date/time">{formatTime(entry.date)}</span>
                            )}
                            <div className="log-entry-body">
                              <span className={`log-type-badge log-type-${entry.type}`}>
                                {entry.type}
                              </span>
                              <span className="log-entry-content">{entry.content}</span>
                              {entry.type === 'question' && (
                            <div className="log-question-answer">
                              {entry.answer ? (
                                <div className="log-answer-display">
                                  <span className="log-answer-label">A:</span>
                                  <span className="log-answer-text">{entry.answer}</span>
                                  <button
                                    className="log-answer-edit-btn"
                                    onClick={() => {
                                      const el = document.getElementById(`answer-${entry.id}`)
                                      if (el) { el.style.display = 'flex'; el.querySelector('input').value = entry.answer; el.querySelector('input').focus() }
                                    }}
                                    title="Edit answer"
                                  >✎</button>
                                </div>
                              ) : (
                                <span className="log-answer-placeholder">No answer yet</span>
                              )}
                              <div id={`answer-${entry.id}`} className="log-answer-input" style={{ display: entry.answer ? 'none' : 'flex' }}>
                                <input
                                  placeholder="Type an answer..."
                                  defaultValue={entry.answer || ''}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && e.target.value.trim()) {
                                      onEditLog(entry.id, { answer: e.target.value.trim() })
                                      e.target.parentElement.style.display = 'none'
                                    }
                                    if (e.key === 'Escape') {
                                      e.target.parentElement.style.display = 'none'
                                    }
                                  }}
                                />
                                <button onClick={e => {
                                  const input = e.target.parentElement.querySelector('input')
                                  if (input.value.trim()) {
                                    onEditLog(entry.id, { answer: input.value.trim() })
                                    e.target.parentElement.style.display = 'none'
                                  }
                                }}>Save</button>
                              </div>
                            </div>
                          )}
                            </div>
                          </div>
                          <div className="log-entry-actions">
                            <button
                              className="log-entry-edit"
                              onClick={() => handleStartEditLog(entry)}
                              title="Edit entry"
                            >
                              ✎
                            </button>
                            <button
                              className="log-entry-delete"
                              onClick={() => onDeleteLog(entry.id)}
                              title="Delete entry"
                            >
                              ×
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="log-empty">
              No entries yet. Capture decisions, wins, metrics, and notes here.
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // ---------- EDIT MODE ----------
  const renderEditMode = () => (
    <div className="detail-scroll">
      <input
        className="detail-title-input"
        value={title}
        onChange={handleTitleChange}
        placeholder="Thread title..."
      />

      {/* Summary */}
      <div className="detail-field">
        <div className="detail-field-label-row">
          <span className="detail-field-label">Summary</span>
          <button
            className="ai-action-btn"
            onClick={handleImproveSummary}
            disabled={aiLoadingSummary}
            title="Improve wording, grammar, and clarity with AI"
          >
            {aiLoadingSummary ? <span className="ai-spinner" /> : <span className="ai-icon">✦</span>}
            Improve with AI
          </button>
        </div>
        <textarea
          ref={textareaRef('summary')}
          value={summary}
          onChange={handleSummaryChange}
          placeholder='Brief description of this thread — what is it and why does it matter?'
          rows={2}
        />
      </div>

      {/* Team & Category */}
      <div className="detail-field-row" style={{ marginBottom: 24 }}>
        <div className="detail-field">
          <div className="detail-field-label">Team</div>
          {isAddingTeam ? (
            <div className="people-add-row">
              <input
                autoFocus
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                placeholder="Team name"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newTeamName.trim()) {
                    e.preventDefault()
                    setTeam(newTeamName.trim())
                    setIsAddingTeam(false)
                    setNewTeamName('')
                  }
                  if (e.key === 'Escape') {
                    setIsAddingTeam(false)
                    setNewTeamName('')
                  }
                }}
              />
              <button
                type="button"
                className="people-add-confirm"
                onClick={() => {
                  if (newTeamName.trim()) {
                    setTeam(newTeamName.trim())
                    setIsAddingTeam(false)
                    setNewTeamName('')
                  }
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="people-add-cancel"
                onClick={() => { setIsAddingTeam(false); setNewTeamName('') }}
              >
                ×
              </button>
            </div>
          ) : (
            <select
              value={team}
              onChange={e => {
                if (e.target.value === '__add_new__') {
                  setIsAddingTeam(true)
                } else {
                  setTeam(e.target.value)
                }
              }}
            >
              <option value="">None</option>
              {team && !teams.includes(team) && (
                <option value={team}>{team}</option>
              )}
              {teams.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="__add_new__">+ Add new...</option>
            </select>
          )}
        </div>
        <div className="detail-field">
          <div className="detail-field-label">Category</div>
          <select value={category} onChange={handleCategoryChange}>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Linked To */}
      <div className="detail-field" style={{ marginBottom: 24 }}>
        <div className="detail-field-label">
          Linked To {parentCategory ? <span className="link-hint">— suggested: {parentCategory}s</span> : ''}
        </div>
        <select value={linkedTo} onChange={handleLinkedToChange}>
          <option value="">None</option>
          {suggestedThreads.length > 0 && (
            <optgroup label={`${parentCategory.charAt(0).toUpperCase() + parentCategory.slice(1)}s`}>
              {suggestedThreads.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </optgroup>
          )}
          {allGroups.map(group => {
            const label = group.category
              ? group.category.charAt(0).toUpperCase() + group.category.slice(1).replace('-', ' ') + 's'
              : 'Uncategorized'
            return (
              <optgroup key={group.category} label={label}>
                {group.threads.map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </optgroup>
            )
          })}
        </select>
        {linkedThread && (
          <div className="linked-thread-preview">
            {linkedThread.title}
            {linkedThread.category && (
              <span className="linked-thread-category"> · {linkedThread.category}</span>
            )}
            {linkedThread.state && (
              <span className="linked-thread-state"> — {linkedThread.state}</span>
            )}
          </div>
        )}
      </div>

      {/* Work Type */}
      <div className="detail-field" style={{ marginBottom: 24 }}>
        <div className="detail-field-label">Work Type</div>
        <select value={workType} onChange={handleWorkTypeChange}>
          {WORK_TYPES.map(w => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      </div>

      {/* Type & Status */}
      <div className="detail-field-row" style={{ marginBottom: 24 }}>
        <div className="detail-field">
          <div className="detail-field-label">Type</div>
          <select value={type} onChange={handleTypeChange}>
            <option value="weekly">Weekly</option>
            <option value="persistent">Persistent</option>
          </select>
        </div>
        <div className="detail-field">
          <div className="detail-field-label">Status</div>
          <select value={status} onChange={handleStatusChange}>
            <option value="active">Active</option>
            <option value="review">In Review</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
        </div>
      </div>

      {/* Push to Focus — visible when Blocked or In Review */}
      {(status === 'blocked' || status === 'review') && (
        <div className="detail-field">
          <div className="detail-field-label">Push to Focus</div>
          <div className="push-quick-picks">
            {[
              { label: '30 min', mins: 30 },
              { label: '1 hour', mins: 60 },
              { label: '2 hours', mins: 120 },
              { label: '4 hours', mins: 240 },
              { label: 'Tomorrow 9am', mins: null },
              { label: 'Mon 9am', mins: null },
            ].map(opt => (
              <button
                key={opt.label}
                type="button"
                className="push-quick-btn"
                onClick={() => {
                  let d
                  if (opt.label === 'Tomorrow 9am') {
                    d = new Date()
                    d.setDate(d.getDate() + 1)
                    d.setHours(9, 0, 0, 0)
                  } else if (opt.label === 'Mon 9am') {
                    d = new Date()
                    const daysUntilMon = (8 - d.getDay()) % 7 || 7
                    d.setDate(d.getDate() + daysUntilMon)
                    d.setHours(9, 0, 0, 0)
                  } else {
                    d = new Date(Date.now() + opt.mins * 60000)
                  }
                  const iso = d.toISOString()
                  setPushToFocus(iso)
                  // saved on "Save"
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="push-custom-row">
            <input
              type="date"
              className="push-date-input"
              value={pushToFocus ? new Date(pushToFocus).toISOString().slice(0, 10) : ''}
              onChange={e => {
                const existing = pushToFocus ? new Date(pushToFocus) : new Date()
                const [y, m, d] = e.target.value.split('-').map(Number)
                existing.setFullYear(y, m - 1, d)
                const iso = existing.toISOString()
                setPushToFocus(iso)
              }}
            />
            <input
              type="time"
              className="push-time-input"
              value={pushToFocus ? `${String(new Date(pushToFocus).getHours()).padStart(2,'0')}:${String(new Date(pushToFocus).getMinutes()).padStart(2,'0')}` : ''}
              onChange={e => {
                const existing = pushToFocus ? new Date(pushToFocus) : new Date()
                const [h, min] = e.target.value.split(':').map(Number)
                existing.setHours(h, min, 0, 0)
                const iso = existing.toISOString()
                setPushToFocus(iso)
              }}
            />
            {pushToFocus && (
              <button
                type="button"
                className="push-clear-btn"
                onClick={() => setPushToFocus('')}
              >
                Clear
              </button>
            )}
          </div>
          {pushToFocus && (
            <div className="push-to-focus-hint">
              Pushes into focus on {new Date(pushToFocus).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* Dropped Reason — visible when Dropped */}
      {status === 'dropped' && (
        <div className="detail-field">
          <div className="detail-field-label">Reason for Dropping</div>
          <textarea
            value={droppedReason}
            onChange={e => setDroppedReason(e.target.value)}
            placeholder="Why is this being dropped?"
            rows={2}
          />
          <button
            type="button"
            className="btn-drop-confirm"
            onClick={handleDropThread}
            disabled={!droppedReason.trim()}
          >
            Log & Drop
          </button>
        </div>
      )}

      {/* PM & Eng Lead */}
      <div className="detail-field-row" style={{ marginBottom: 24 }}>
        <PeopleSelect
          label="PM"
          value={pm}
          options={people.pms}
          onChange={handlePmChange}
          placeholder="Enter name"
        />
        <PeopleSelect
          label="Eng Lead"
          value={engLead}
          options={people.engLeads}
          onChange={handleEngLeadChange}
          placeholder="Enter name"
        />
        <PeopleSelect
          label="UX Partner"
          value={uxPartner}
          options={people.uxPartners || []}
          onChange={handleUxPartnerChange}
          placeholder="Enter name"
        />
      </div>

      {/* KPIs */}
      <div className="detail-field">
        <div className="detail-field-label-row">
          <span className="detail-field-label">KPIs</span>
          <button
            className="ai-action-btn"
            onClick={handleFillKpi}
            disabled={aiLoadingKpi}
            title="Generate a KPI metric with AI based on thread context"
          >
            {aiLoadingKpi ? <span className="ai-spinner" /> : <span className="ai-icon">✦</span>}
            Fill with AI
          </button>
        </div>
        {kpis.map((k, i) => (
          <div key={i} className="kpi-input-row">
            <input
              type="text"
              value={k}
              onChange={e => handleKpiChange(i, e.target.value)}
              placeholder='e.g. "Reduce onboarding drop-off from 40% to 25%"'
            />
            {kpis.length > 1 && (
              <button className="kpi-remove-btn" onClick={() => handleRemoveKpi(i)} title="Remove KPI">×</button>
            )}
          </div>
        ))}
        {kpis.length < 4 && (
          <button className="kpi-add-btn" onClick={handleAddKpi}>+ Add KPI</button>
        )}
      </div>

      {aiError && (
        <div className="ai-error">{aiError}</div>
      )}

      {/* Current State & Next Action */}
      <div className="detail-field">
        <div className="detail-field-label">Current State</div>
        <textarea
          ref={textareaRef('state')}
          value={state}
          onChange={handleStateChange}
          placeholder='e.g. "Reviewed failed states in QA — 3 of 5 edge cases handled, waiting on API fix for the other 2"'
          rows={2}
        />
      </div>

      <div className="detail-field">
        <div className="detail-field-label">Next Action</div>
        <input
          value={nextAction}
          onChange={handleNextActionChange}
          placeholder="What's the next move?"
        />
      </div>

      {(state || nextAction) && (
        <button
          type="button"
          className="btn-snapshot"
          onClick={handleSnapshot}
        >
          Snapshot Progress
        </button>
      )}

      {/* Resume Link */}
      <div className="detail-field">
        <div className="detail-field-label">Resume Link</div>
        <div className="resume-link-row">
          <input
            value={resumeLink}
            onChange={handleResumeLinkChange}
            placeholder="https://..."
          />
          {resumeLink && (
            <button
              className="resume-link-open"
              onClick={() => window.open(resumeLink, '_blank')}
            >
              Open ↗
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div
        className={`panel-backdrop ${closing ? 'panel-backdrop-closing' : ''}`}
        onClick={onClose}
      />

      <div className={`detail-panel ${navAction === 'open' ? 'anim-slide' : ''} ${closing ? 'anim-close' : ''}`} onKeyDown={handleKeyDown} style={{ '--panel-width': `${panelWidth}px` }}>
        <div className="panel-resize-handle" onMouseDown={onResizeStart} onTouchStart={onResizeStart} />
        {(navStack.length > 1 || onBackToProject) && (
          <div className="breadcrumb-nav detail-breadcrumb">
            <button className="project-view-back" onClick={onBackToProject || onClose}>←</button>
            {navStack.slice(0, -1).map((id, i) => {
              const t = allNavThreads.find(th => th.id === id)
              return (
                <span key={id} className="breadcrumb-item">
                  <span className="breadcrumb-sep">/</span>
                  <button className="breadcrumb-link" onClick={() => onBreadcrumbNav(i)}>
                    {t?.title || 'Thread'}
                  </button>
                </span>
              )
            })}
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{thread.title}</span>
          </div>
        )}
        <div className="detail-panel-header">
          <div className="detail-panel-actions">
            {onBackToProject && !navStack.length && (
              <button className="detail-back-to-project" onClick={onBackToProject}>
                ← Back to project
              </button>
            )}
            {mode === 'view' ? (
              <>
                <button className="btn btn-secondary" onClick={() => setMode('edit')}>
                  Edit details
                </button>
                <button className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={handleSaveAll}>
                  Save
                </button>
                <button className="btn btn-secondary" onClick={handleCancel}>
                  Cancel
                </button>
                {isFocus && (
                  <button className="btn btn-secondary" onClick={onDemote}>
                    ↓ Staged
                  </button>
                )}
                <button className="btn btn-danger" onClick={onDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
          <button className="detail-close" onClick={onClose}>×</button>
        </div>

        <div className={`panel-content-wrap ${navAction !== 'open' ? 'panel-content-fade' : ''}`} key={thread.id}>
          {mode === 'view' ? renderViewMode() : renderEditMode()}
        </div>
      </div>
    </>
  )
}
