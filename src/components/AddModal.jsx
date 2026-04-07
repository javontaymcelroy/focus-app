import React, { useState } from 'react'

export default function AddModal({ target, onClose, onSubmit, focusCount, teams = [] }) {
  const [title, setTitle] = useState('')
  const [team, setTeam] = useState('')
  const [stream, setStream] = useState(target)
  const [error, setError] = useState(null)
  const [isAddingTeam, setIsAddingTeam] = useState(false)
  const [newTeam, setNewTeam] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Give your thread a name')
      return
    }
    const actualStream = stream === 'out-of-focus' ? 'focus' : stream
    if ((stream === 'focus' || stream === 'out-of-focus') && focusCount >= 5) {
      setError('Focus stream is full (max 5). Demote or complete an item first.')
      return
    }
    onSubmit({
      title: title.trim(),
      team: team.trim(),
      stream: actualStream,
      outOfFocus: stream === 'out-of-focus',
      type: 'weekly',
      tags: stream === 'undercurrent' ? ['explore'] : []
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-modal add-modal-compact" onClick={e => e.stopPropagation()}>
        <h2>New Thread</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>What are you working on?</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Onboarding redesign"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Team</label>
              {isAddingTeam ? (
                <>
                  <input
                    autoFocus
                    value={newTeam}
                    onChange={e => setNewTeam(e.target.value)}
                    placeholder="Team name"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newTeam.trim()) {
                        e.preventDefault()
                        setTeam(newTeam.trim())
                        setIsAddingTeam(false)
                        setNewTeam('')
                      }
                      if (e.key === 'Escape') {
                        setIsAddingTeam(false)
                        setNewTeam('')
                      }
                    }}
                  />
                  <div className="add-team-actions">
                    <button
                      type="button"
                      className="people-add-cancel"
                      onClick={() => { setIsAddingTeam(false); setNewTeam('') }}
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      className="people-add-confirm"
                      onClick={() => {
                        if (newTeam.trim()) {
                          setTeam(newTeam.trim())
                          setIsAddingTeam(false)
                          setNewTeam('')
                        }
                      }}
                    >
                      Save
                    </button>
                  </div>
                </>
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
            <div className="form-group">
              <label>Stream</label>
              <select value={stream} onChange={e => setStream(e.target.value)}>
                <option value="focus">In Focus</option>
                <option value="out-of-focus">Out of Focus</option>
                <option value="undercurrent">Staged</option>
              </select>
            </div>
          </div>

          <p className="form-hint">You can add KPI, category, work type, and more after creating.</p>

          {error && <div className="error-msg">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
