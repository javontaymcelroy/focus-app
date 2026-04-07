import React, { useState } from 'react'

const QUARTERS = [
  { key: 'Q1', label: 'Q1', months: 'Jan – Mar' },
  { key: 'Q2', label: 'Q2', months: 'Apr – Jun' },
  { key: 'Q3', label: 'Q3', months: 'Jul – Sep' },
  { key: 'Q4', label: 'Q4', months: 'Oct – Dec' },
]

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
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

// Quarter span utilities
const toQKey = (year, q) => `${year}-Q${q}`
const parseQKey = (key) => { const [y, qp] = key.split('-Q'); return { year: Number(y), q: Number(qp) } }
const dateToQKey = (dateStr) => { const d = new Date(dateStr); return toQKey(d.getFullYear(), Math.ceil((d.getMonth() + 1) / 3)) }
const qKeyToNum = (key) => { const { year, q } = parseQKey(key); return year * 4 + q }
const getThreadQStart = (t) => t.quarterStart || dateToQKey(t.createdAt || t.updatedAt)
const getThreadQEnd = (t) => t.quarterEnd || getThreadQStart(t)
const threadOverlapsQ = (t, year, qNum) => {
  const target = qKeyToNum(toQKey(year, qNum))
  const start = qKeyToNum(getThreadQStart(t))
  const end = qKeyToNum(getThreadQEnd(t))
  return target >= start && target <= end
}

export default function ProjectView({ project, allThreads, onClose, onSelectThread, onEditProject, navStack = [], allNavThreads = [], onBreadcrumbNav, panelWidth, onResizeStart, navAction = 'open', closing = false }) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentQ = `Q${Math.ceil((now.getMonth() + 1) / 3)}`

  const [year, setYear] = useState(currentYear)
  const [activeQuarter, setActiveQuarter] = useState(currentQ)
  const [categoryFilter, setCategoryFilter] = useState('')

  // Find all epics linked to this project
  const linkedEpicIds = allThreads
    .filter(t => t.linkedTo === project.id && t.category === 'epic')
    .map(e => e.id)
  const linkedEpics = allThreads.filter(t => t.linkedTo === project.id && t.category === 'epic')

  // All threads under this project (direct + via epics), including epics themselves
  const allProjectChildren = allThreads.filter(t =>
    (t.linkedTo === project.id || linkedEpicIds.includes(t.linkedTo)) &&
    t.category !== 'project'
  )

  // Filter by selected quarter + year (range-aware)
  const activeQNum = Number(activeQuarter.replace('Q', ''))
  const quarterThreads = allProjectChildren.filter(t => threadOverlapsQ(t, year, activeQNum))

  // Filter by category
  const filteredThreads = categoryFilter
    ? quarterThreads.filter(t => t.category === categoryFilter)
    : quarterThreads

  // Year range
  const projectYear = new Date(project.createdAt).getFullYear()
  const startYear = Math.min(projectYear, currentYear - 1)
  const endYear = currentYear + 1
  const years = []
  for (let y = endYear; y >= startYear; y--) {
    years.push(y)
  }

  // Stats for active quarter
  const totalWins = quarterThreads.reduce((n, t) => n + (t.log?.filter(l => l.type === 'win').length || 0), 0)

  // Quarter thread counts for badges (range-aware)
  const quarterCounts = {}
  for (const q of QUARTERS) {
    const qNum = Number(q.key.replace('Q', ''))
    quarterCounts[q.key] = allProjectChildren.filter(t => threadOverlapsQ(t, year, qNum)).length
  }

  return (
    <>
      <div className={`panel-backdrop ${closing ? 'panel-backdrop-closing' : ''}`} onClick={onClose} />
      <div className={`project-view ${navAction === 'open' ? 'anim-slide' : ''} ${closing ? 'anim-close' : ''}`} style={{ '--panel-width': `${panelWidth}px` }}>
        <div className="panel-resize-handle" onMouseDown={onResizeStart} onTouchStart={onResizeStart} />
        {/* Breadcrumb + year */}
        <div className="project-view-topbar">
          <div className="breadcrumb-nav">
            <button className="project-view-back" onClick={onClose}>←</button>
            {navStack.length > 1 && navStack.slice(0, -1).map((id, i) => {
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
            <span className="breadcrumb-current">{project.title}</span>
          </div>
          <select
            className="project-view-year-select"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
          >
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className={`panel-content-wrap ${navAction !== 'open' ? 'panel-content-fade' : ''}`} key={project.id}>
        {/* Project info card */}
        <div className="project-view-info" onClick={onEditProject} style={{ cursor: 'pointer' }}>
          <div className="project-view-info-top">
            <div className="project-view-info-context">
              {project.team && <span className="thread-team-label">{project.team}</span>}
              <span className="thread-category-label category-project">Project</span>
              {project.workType && (
                <span className={`thread-worktype-label worktype-${project.workType}`}>
                  {WORK_TYPE_LABELS[project.workType] || project.workType}
                </span>
              )}
            </div>
            <button className="project-view-edit" onClick={e => { e.stopPropagation(); onEditProject() }}>Edit thread details</button>
          </div>

          <div className="project-view-info-title">{project.title}</div>

          {project.summary && (
            <div className="detail-view-summary">{project.summary}</div>
          )}

          {(project.kpis?.length ? project.kpis : project.kpi ? [project.kpi] : []).map((k, i) => (
            <div className="thread-card-kpi" key={i} style={{ marginBottom: 4 }}>
              <span className="kpi-icon">◎</span>
              {k}
            </div>
          ))}

          {project.state && (
            <div className="project-view-info-state">{project.state}</div>
          )}

          {(project.pm || project.engLead || project.uxPartner) && (
            <div className="thread-card-people">
              {project.pm && <span>PM: {project.pm}</span>}
              {project.pm && project.engLead && <span className="people-sep">·</span>}
              {project.engLead && <span>Eng: {project.engLead}</span>}
              {(project.pm || project.engLead) && project.uxPartner && <span className="people-sep">·</span>}
              {project.uxPartner && <span>UX: {project.uxPartner}</span>}
            </div>
          )}

          {project.nextAction && (
            <div className="project-view-info-next">
              <span className="thread-card-next-arrow">→</span>
              <svg className="thread-card-next-shoe" viewBox="0 0 800 800" fill="currentColor"><path d="M723.605 329.74C737.916 349.775 733.359 377.856 713.445 392.339L243.389 734.198C235.427 739.99 226.015 743.049 216.168 743.049H97.0789C81.071 743.049 68.0498 730.026 68.0496 714.021C68.0496 707.072 73.6828 701.439 80.6317 701.439H185.889C190.657 701.439 195.306 699.952 199.193 697.191L717.079 328.647C719.183 327.149 722.103 327.639 723.605 329.74Z"/><path d="M672.087 257.622C684.3 274.72 680.318 298.486 663.197 310.669L188.452 648.514C182.018 653.093 174.317 655.553 166.42 655.553H106.05C85.0628 655.553 68.0496 638.54 68.0496 617.553V612.38C68.0496 599.327 76.3703 587.782 88.7527 583.656L175.02 554.899C197.194 547.505 215.164 531.919 225.615 511.017C229.74 502.765 240.737 500.98 247.259 507.504L256.981 517.226C262.253 522.495 269.16 525.131 276.066 525.131C282.972 525.131 289.879 522.494 295.15 517.226C305.69 506.686 305.69 489.598 295.15 479.055L270.063 453.966C263.723 447.625 262.151 437.938 266.161 429.918C272.52 417.199 289.471 414.448 299.526 424.503L324.615 449.592C329.886 454.861 336.794 457.497 343.7 457.497C350.609 457.497 357.513 454.861 362.784 449.592C373.324 439.052 373.324 421.961 362.784 411.421L308.312 356.949C306.055 354.692 305.495 351.243 306.924 348.388C313.332 335.572 316.718 321.226 316.718 306.899C316.718 306.433 317.28 306.2 317.609 306.529L342.256 331.176C347.527 336.445 354.433 339.081 361.34 339.081C368.246 339.081 375.152 336.445 380.424 331.176C390.964 320.636 390.964 303.545 380.424 293.005L327.844 240.423C320.718 233.297 316.715 223.632 316.715 213.554V167.494C316.715 151.956 326.175 137.983 340.602 132.212L501.053 68.0302C517.312 61.5266 535.91 66.9756 546.088 81.225L672.087 257.622Z"/></svg>
              {project.nextAction}
            </div>
          )}

          {/* Epics chips */}
          {linkedEpics.length > 0 && (
            <div className="project-view-epics-inline">
              <span className="project-view-epics-label-inline">Epics:</span>
              {linkedEpics.map(epic => {
                const epicChildren = allThreads.filter(t => t.linkedTo === epic.id && t.category !== 'project' && t.category !== 'epic')
                return (
                  <button
                    key={epic.id}
                    className="project-view-epic-chip"
                    onClick={() => onSelectThread(epic.id)}
                  >
                    <span className="project-view-epic-name">{epic.title}</span>
                    <span className="project-view-epic-count">{epicChildren.length}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Quarter filter row */}
        <div className="project-view-filters">
          <div className="project-view-quarter-filters">
            {QUARTERS.map(q => {
              const isCurrent = year === currentYear && q.key === currentQ
              const count = quarterCounts[q.key]
              return (
                <button
                  key={q.key}
                  className={`pv-quarter-chip ${activeQuarter === q.key ? 'active' : ''} ${isCurrent ? 'current' : ''}`}
                  onClick={() => setActiveQuarter(q.key)}
                >
                  {q.label}
                  <span className="pv-quarter-months">{q.months}</span>
                  {count > 0 && <span className="pv-quarter-count">{count}</span>}
                  {isCurrent && activeQuarter !== q.key && <span className="pv-quarter-now-dot">📌</span>}
                </button>
              )
            })}
          </div>

          {/* Category sub-filter */}
          <div className="project-view-category-filters">
            {CATEGORY_FILTERS.map(c => (
              <button
                key={c.value}
                className={`pv-category-chip ${categoryFilter === c.value ? 'active' : ''}`}
                onClick={() => setCategoryFilter(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary bar */}
        <div className="project-view-summary">
          <span className="project-view-summary-stat">
            {filteredThreads.length} thread{filteredThreads.length !== 1 ? 's' : ''}
          </span>
          {totalWins > 0 && (
            <span className="project-view-summary-stat project-view-summary-wins">
              {totalWins} win{totalWins !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Thread list */}
        <div className="project-view-thread-list">
          {filteredThreads.length > 0 ? (
            filteredThreads.map(thread => {
              const parentEpic = thread.linkedTo && linkedEpicIds.includes(thread.linkedTo)
                ? allThreads.find(t => t.id === thread.linkedTo)
                : null
              const threadWins = thread.log?.filter(l => l.type === 'win').length || 0

              return (
                <div
                  key={thread.id}
                  className="project-view-thread"
                  onClick={() => onSelectThread(thread.id)}
                >
                  <div className="project-view-thread-main">
                    <div className="project-view-thread-title">{thread.title}</div>
                    {parentEpic && (
                      <span className="project-view-thread-epic">{parentEpic.title}</span>
                    )}
                  </div>
                  <div className="project-view-thread-meta">
                    {thread.category && (
                      <span className={`thread-category-label category-${thread.category}`}>
                        {CATEGORY_LABELS[thread.category] || thread.category}
                      </span>
                    )}
                    {thread.workType && (
                      <span className={`thread-worktype-label worktype-${thread.workType}`}>
                        {WORK_TYPE_LABELS[thread.workType] || thread.workType}
                      </span>
                    )}
                    {thread.status === 'completed' && (
                      <span className="project-view-thread-done">Done</span>
                    )}
                    {threadWins > 0 && (
                      <span className="project-view-thread-wins">{threadWins} win{threadWins !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {thread.summary && (
                    <div className="project-view-thread-state">{thread.summary}</div>
                  )}
                  {(thread.kpis?.length ? thread.kpis : thread.kpi ? [thread.kpi] : []).map((k, i) => (
                    <div className="thread-card-kpi" key={i}>
                      <span className="kpi-icon">◎</span>
                      {k}
                    </div>
                  ))}
                  {thread.nextAction && (
                    <div className="project-view-thread-next">→ {thread.nextAction}</div>
                  )}
                </div>
              )
            })
          ) : (
            <div className="project-view-empty">
              No threads in {activeQuarter}{categoryFilter ? ` for ${CATEGORY_LABELS[categoryFilter] || categoryFilter}` : ''}.
            </div>
          )}
        </div>
        </div>
      </div>
    </>
  )
}
