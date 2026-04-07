import React from 'react'

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

export default function ThreadCard({ thread, allThreads = [], onClick }) {
  const linkedThread = thread.linkedTo ? allThreads.find(t => t.id === thread.linkedTo) : null
  return (
    <div className="thread-card" onClick={onClick}>
      {/* Top row: team · project | chips */}
      <div className="thread-card-top">
        <div className="thread-card-context">
          {thread.team && (
            <span className="thread-team-label">{thread.team}</span>
          )}
          {thread.team && linkedThread && <span className="context-sep">·</span>}
          {linkedThread && (
            <span className="thread-card-parent-title">{linkedThread.title}</span>
          )}
        </div>
        <div className="thread-card-chips">
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
          {thread.resumeLink && (
            <a
              className="thread-card-resume"
              href={thread.resumeLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
            >
              Resume ↗
            </a>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="thread-card-title">{thread.title}</div>

      {thread.summary && (
        <div className="thread-card-summary">{thread.summary}</div>
      )}

      {(thread.kpis?.length ? thread.kpis : thread.kpi ? [thread.kpi] : []).map((k, i) => (
        <div className="thread-card-kpi" key={i}>
          <span className="kpi-icon">◎</span>
          {k}
        </div>
      ))}

      {thread.state && (
        <div className="thread-card-state">{thread.state}</div>
      )}

      {(thread.pm || thread.engLead || thread.uxPartner) && (
        <div className="thread-card-people">
          {thread.pm && <span>PM: {thread.pm}</span>}
          {thread.pm && thread.engLead && <span className="people-sep">·</span>}
          {thread.engLead && <span>Eng: {thread.engLead}</span>}
          {(thread.pm || thread.engLead) && thread.uxPartner && <span className="people-sep">·</span>}
          {thread.uxPartner && <span>UX: {thread.uxPartner}</span>}
        </div>
      )}

      {/* Bottom row: next action + badges */}
      <div className="thread-card-footer">
        <div className="thread-card-next">
          {thread.nextAction && (
            <>
              <span className="thread-card-next-arrow">→</span>
              <svg className="thread-card-next-shoe" viewBox="0 0 800 800" fill="currentColor"><path d="M723.605 329.74C737.916 349.775 733.359 377.856 713.445 392.339L243.389 734.198C235.427 739.99 226.015 743.049 216.168 743.049H97.0789C81.071 743.049 68.0498 730.026 68.0496 714.021C68.0496 707.072 73.6828 701.439 80.6317 701.439H185.889C190.657 701.439 195.306 699.952 199.193 697.191L717.079 328.647C719.183 327.149 722.103 327.639 723.605 329.74Z"/><path d="M672.087 257.622C684.3 274.72 680.318 298.486 663.197 310.669L188.452 648.514C182.018 653.093 174.317 655.553 166.42 655.553H106.05C85.0628 655.553 68.0496 638.54 68.0496 617.553V612.38C68.0496 599.327 76.3703 587.782 88.7527 583.656L175.02 554.899C197.194 547.505 215.164 531.919 225.615 511.017C229.74 502.765 240.737 500.98 247.259 507.504L256.981 517.226C262.253 522.495 269.16 525.131 276.066 525.131C282.972 525.131 289.879 522.494 295.15 517.226C305.69 506.686 305.69 489.598 295.15 479.055L270.063 453.966C263.723 447.625 262.151 437.938 266.161 429.918C272.52 417.199 289.471 414.448 299.526 424.503L324.615 449.592C329.886 454.861 336.794 457.497 343.7 457.497C350.609 457.497 357.513 454.861 362.784 449.592C373.324 439.052 373.324 421.961 362.784 411.421L308.312 356.949C306.055 354.692 305.495 351.243 306.924 348.388C313.332 335.572 316.718 321.226 316.718 306.899C316.718 306.433 317.28 306.2 317.609 306.529L342.256 331.176C347.527 336.445 354.433 339.081 361.34 339.081C368.246 339.081 375.152 336.445 380.424 331.176C390.964 320.636 390.964 303.545 380.424 293.005L327.844 240.423C320.718 233.297 316.715 223.632 316.715 213.554V167.494C316.715 151.956 326.175 137.983 340.602 132.212L501.053 68.0302C517.312 61.5266 535.91 66.9756 546.088 81.225L672.087 257.622Z"/></svg>
              {thread.nextAction}
            </>
          )}
        </div>
        <div className="thread-card-meta">
          {thread.type === 'persistent' && (
            <span className="badge badge-persistent">Persistent</span>
          )}
          {thread.type === 'weekly' && (
            <span className="badge badge-weekly">Weekly</span>
          )}
          {thread.status === 'review' && (
            <span className="badge badge-review">In Review</span>
          )}
          {thread.log?.length > 0 && (
            <span className="thread-card-entries">{thread.log.length} entries</span>
          )}
        </div>
      </div>
    </div>
  )
}
