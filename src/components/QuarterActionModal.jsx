import React from 'react'

export default function QuarterActionModal({ thread, targetYear, targetQ, onMove, onSpan, onClose }) {
  const targetLabel = `Q${targetQ} ${targetYear}`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="quarter-action-modal" onClick={e => e.stopPropagation()}>
        <h2>Move or Span?</h2>
        <p className="quarter-action-thread-name">{thread.title}</p>
        <p className="quarter-action-desc">
          What would you like to do with this thread in <strong>{targetLabel}</strong>?
        </p>
        <div className="quarter-action-options">
          <button className="quarter-action-btn quarter-action-move" onClick={onMove}>
            <span className="quarter-action-btn-title">Move</span>
            <span className="quarter-action-btn-desc">Relocate this thread to {targetLabel} only</span>
          </button>
          <button className="quarter-action-btn quarter-action-span" onClick={onSpan}>
            <span className="quarter-action-btn-title">Span</span>
            <span className="quarter-action-btn-desc">Extend this thread to also cover {targetLabel}</span>
          </button>
        </div>
        <button className="quarter-action-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
