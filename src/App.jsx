import React, { useState, useEffect, useCallback, useRef } from 'react'
import * as api from './api'
import ThreadCard from './components/ThreadCard'
import ThreadDetail from './components/ThreadDetail'
import AddModal from './components/AddModal'
import ProjectView from './components/ProjectView'
import QuarterActionModal from './components/QuarterActionModal'
import { getApiKey, setApiKey as saveApiKey } from './ai'
import { getPersistedSize, persistSize } from './persist'

export default function App() {
  const [state, setState] = useState(null)
  const [navStack, setNavStack] = useState([]) // stack of thread IDs for breadcrumb nav
  const selectedThreadId = navStack.length > 0 ? navStack[navStack.length - 1] : null
  const [selectedThread, setSelectedThread] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addTarget, setAddTarget] = useState('focus')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [ucInput, setUcInput] = useState('')
  const [teams, setTeams] = useState([])
  const [people, setPeople] = useState({ pms: [], engLeads: [], uxPartners: [] })
  const [activeTeamFilter, setActiveTeamFilter] = useState(null)
  const [editingProject, setEditingProject] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [displacedThreadId, setDisplacedThreadId] = useState(null)
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [panelWidth, setPanelWidth] = useState(() => getPersistedSize('panelWidth') || 680)
  const [stagedReplaceModal, setStagedReplaceModal] = useState(null) // { pendingAction: async (replaceId) => {} }
  const resizing = useRef(false)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    resizing.current = true
    let lastWidth = panelWidth
    const onMove = (e) => {
      if (!resizing.current) return
      const newWidth = Math.max(400, Math.min(window.innerWidth - (e.clientX || e.touches?.[0]?.clientX), window.innerWidth * 0.9))
      lastWidth = newWidth
      setPanelWidth(newWidth)
    }
    const onUp = () => {
      resizing.current = false
      persistSize('panelWidth', lastWidth)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove)
    document.addEventListener('touchend', onUp)
  }, [])
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3)
  const [filterQuarter, setFilterQuarterRaw] = useState(() => {
    const saved = localStorage.getItem('focus_filter_quarter')
    if (saved === 'null') return null
    if (saved) return Number(saved)
    return currentQuarter
  })
  const setFilterQuarter = (val) => {
    setFilterQuarterRaw(val)
    localStorage.setItem('focus_filter_quarter', String(val))
  }

  const refresh = useCallback(async () => {
    try {
      const [data, teamList, peopleList] = await Promise.all([
        api.fetchState(),
        api.fetchTeams(),
        api.fetchPeople()
      ])
      setState(data)
      setTeams(teamList)
      setPeople(peopleList)
    } catch (e) {
      console.error('Failed to fetch state:', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Push to Focus timer — keep a ref so the interval doesn't re-register on every render
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const pushWarningsShown = useRef({})
  const pushInProgress = useRef(false)
  useEffect(() => {
    const checkPushToFocus = async () => {
      if (pushInProgress.current) return
      const currentState = stateRef.current
      const allThreads = currentState?.allThreads || []
      const now = Date.now()

      for (const thread of allThreads) {
        if (!thread.pushToFocus || thread.status === 'completed' || thread.status === 'dropped') continue
        const pushTime = new Date(thread.pushToFocus).getTime()
        if (isNaN(pushTime)) continue
        const secsLeft = (pushTime - now) / 1000
        const minsLeft = secsLeft / 60
        const key = thread.id

        // Only push when time has actually passed (secsLeft <= 0)
        if (secsLeft <= 0) {
          pushInProgress.current = true
          try {
            const inFocus = currentState?.focusOrder?.includes(thread.id)
            if (!inFocus) {
              // Always demote the current #1 to Staged when a push arrives
              if (currentState?.focusOrder?.length > 0) {
                const firstId = currentState.focusOrder[0]
                await api.demoteToUndercurrent(firstId)
                setDisplacedThreadId(firstId)
                const firstThread = allThreads.find(t => t.id === firstId)
                if (firstThread) showToast(`${firstThread.title} moved to Staged`)
              }
              const inUndercurrent = currentState?.undercurrent?.some(u => u.id === thread.id)
              if (inUndercurrent) {
                await api.promoteToFocus(thread.id)
              }
              await api.reorderFocus(thread.id, 0)
            } else {
              // Already in focus — just move to #1, demote old #1 to Staged
              const firstId = currentState.focusOrder[0]
              if (firstId && firstId !== thread.id) {
                await api.demoteToUndercurrent(firstId)
                setDisplacedThreadId(firstId)
                const firstThread = allThreads.find(t => t.id === firstId)
                if (firstThread) showToast(`${firstThread.title} moved to Staged`)
              }
              await api.reorderFocus(thread.id, 0)
            }
            await api.updateThread(thread.id, { pushToFocus: null, status: 'active' })
            await api.updateThreadStatus(thread.id, 'active')
            await refresh()
            showToast(`⏰ ${thread.title} pushed into focus!`)
            delete pushWarningsShown.current[key]
          } catch (err) {
            console.error('Push to focus failed:', err)
          } finally {
            pushInProgress.current = false
          }
          continue
        }

        // Countdown warnings at 15, 10, 5, 4, 3, 2, 1 minutes
        const warningMins = [15, 10, 5, 4, 3, 2, 1]
        for (const warnAt of warningMins) {
          if (minsLeft <= warnAt && minsLeft > (warnAt - 1)) {
            const warnKey = `${key}-${warnAt}`
            if (!pushWarningsShown.current[warnKey]) {
              pushWarningsShown.current[warnKey] = true
              showToast(`${thread.title} pushes into focus in ${warnAt} min`)
            }
            break
          }
        }
      }
    }

    const interval = setInterval(checkPushToFocus, 10000) // check every 10s
    checkPushToFocus()
    return () => clearInterval(interval)
  }, []) // run once — uses stateRef for current data

  // Navigation helpers
  const [navAction, setNavAction] = useState('open') // 'open' | 'forward' | 'back'
  const [panelClosing, setPanelClosing] = useState(false)
  const navigateTo = (id) => {
    setNavAction(navStack.length === 0 ? 'open' : 'forward')
    setPanelClosing(false)
    setNavStack(prev => [...prev, id])
  }
  const navigateBack = () => {
    setNavAction('back')
    setNavStack(prev => prev.slice(0, -1))
  }
  const navigateClose = () => {
    setPanelClosing(true)
    setTimeout(() => {
      setNavAction('open')
      setNavStack([])
      setPanelClosing(false)
    }, 300)
  }

  // Load thread detail when selected
  useEffect(() => {
    if (selectedThreadId) {
      api.getThread(selectedThreadId).then(setSelectedThread).catch(() => setSelectedThread(null))
      setEditingProject(false)
    } else {
      setSelectedThread(null)
      setEditingProject(false)
    }
  }, [selectedThreadId])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const handleAddThread = async (data) => {
    try {
      await api.createThread(data)
      await refresh()
      setShowAdd(false)
      showToast('Thread created')
    } catch (e) {
      showToast(e.message)
    }
  }

  const STAGED_MAX = 3

  const getStagedItems = () => {
    return state?.undercurrent?.filter(u => {
      const t = state?.allThreads?.find(th => th.id === u.id)
      return t ? (t.category !== 'project' && t.category !== 'epic' && t.status !== 'completed') : true
    }) || []
  }

  const handleQuickAddUC = async (e) => {
    e.preventDefault()
    if (!ucInput.trim()) return
    try {
      await api.createThread({ title: ucInput.trim(), stream: 'focus', outOfFocus: true, tags: ['explore'] })
      setUcInput('')
      await refresh()
    } catch (e) {
      showToast(e.message)
    }
  }

  const handlePromote = async (id) => {
    try {
      await api.promoteToFocus(id)
      await refresh()
      showToast('Promoted to focus')
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleMoveToOutOfFocus = async (id) => {
    try {
      await api.stagedToOutOfFocus(id)
      await refresh()
      showToast('Moved to Out of Focus')
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleDemote = async (id) => {
    const staged = getStagedItems()
    if (staged.length >= STAGED_MAX) {
      setStagedReplaceModal({
        pendingAction: async (replaceId) => {
          try {
            await api.swapFocusStaged(id, replaceId)
            await refresh()
            navigateClose()
            showToast('Replaced and moved to staged')
          } catch (e) {
            showToast(e.message)
          }
        }
      })
      return
    }
    try {
      await api.demoteToUndercurrent(id)
      await refresh()
      navigateClose()
      showToast('Moved to staged')
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.deleteThread(id)
      await refresh()
      if (selectedThreadId === id) navigateClose()
      showToast('Thread removed')
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleUpdateThread = async (id, data) => {
    try {
      await api.updateThread(id, data)
      const updated = await api.getThread(id)
      setSelectedThread(updated)
      await refresh()
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleMakeInFocus = async (id) => {
    try {
      await api.reorderFocus(id, 0)
      await refresh()
      showToast('Now in focus')
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleMoveOutOfFocus = async (id) => {
    try {
      // Move to end of focusOrder (out of focus)
      const currentOrder = state?.focusOrder || []
      await api.reorderFocus(id, currentOrder.length - 1)
      await refresh()
      showToast('Moved out of focus')
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleReorderFocus = async (id, newIndex) => {
    try {
      await api.reorderFocus(id, newIndex)
      await refresh()
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleEvolveThread = async (id, data) => {
    try {
      await api.evolveThread(id, data)
      const updated = await api.getThread(id)
      setSelectedThread(updated)
      await refresh()
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleAddLog = async (threadId, entry) => {
    try {
      await api.addLogEntry(threadId, entry)
      const updated = await api.getThread(threadId)
      setSelectedThread(updated)
      await refresh()
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleDeleteLog = async (threadId, logId) => {
    try {
      await api.deleteLogEntry(threadId, logId)
      const updated = await api.getThread(threadId)
      setSelectedThread(updated)
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleEditLog = async (threadId, logId, data) => {
    try {
      await api.editLogEntry(threadId, logId, data)
      const updated = await api.getThread(threadId)
      setSelectedThread(updated)
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleStatusChange = async (id, status) => {
    try {
      await api.updateThreadStatus(id, status)
      if (status === 'completed') {
        navigateClose()
        await refresh()
        showToast('Thread completed')
      } else {
        const updated = await api.getThread(id)
        setSelectedThread(updated)
        await refresh()
      }
    } catch (e) {
      showToast(e.message)
    }
  }

  const handleClickInFocus = () => {
    const inFocusThread = state?.focusThreads?.[0]
    if (inFocusThread) navigateTo(inFocusThread.id)
  }

  const inFocusTitle = state?.focusThreads?.[0]?.title

  // Quarters helper
  const getQuarter = (dateStr) => {
    const d = new Date(dateStr)
    const q = Math.ceil((d.getMonth() + 1) / 3)
    return { label: `Q${q} ${d.getFullYear()}`, q, year: d.getFullYear() }
  }
  const now = new Date()
  const currentQ = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`

  // Projects as containers with quarter context
  const allT = state?.allThreads || []
  const projects = allT.filter(t => t.category === 'project')
  const epics = allT.filter(t => t.category === 'epic')

  // Work items only (not projects/epics) for focus and undercurrent
  const isWorkItem = (t) => t.category !== 'project' && t.category !== 'epic'

  // Quarter/year filtering
  const QUARTERS = [
    { value: 1, label: 'Q1', range: 'Jan \u2013 Mar' },
    { value: 2, label: 'Q2', range: 'Apr \u2013 Jun' },
    { value: 3, label: 'Q3', range: 'Jul \u2013 Sep' },
    { value: 4, label: 'Q4', range: 'Oct \u2013 Dec' },
  ]

  // Quarter span utilities
  const toQKey = (year, q) => `${year}-Q${q}`
  const parseQKey = (key) => {
    const [y, qPart] = key.split('-Q')
    return { year: Number(y), q: Number(qPart) }
  }
  const dateToQKey = (dateStr) => {
    const d = new Date(dateStr)
    return toQKey(d.getFullYear(), Math.ceil((d.getMonth() + 1) / 3))
  }
  const qKeyToNum = (key) => { const { year, q } = parseQKey(key); return year * 4 + q }
  const numToQKey = (n) => { const q = ((n - 1) % 4) + 1; const year = Math.floor((n - 1) / 4); return toQKey(year, q) }

  const getThreadQStart = (t) => t.quarterStart || dateToQKey(t.createdAt || t.updatedAt)
  const getThreadQEnd = (t) => t.quarterEnd || getThreadQStart(t)

  const threadOverlapsQuarter = (t, year, q) => {
    const target = qKeyToNum(toQKey(year, q))
    const start = qKeyToNum(getThreadQStart(t))
    const end = qKeyToNum(getThreadQEnd(t))
    return target >= start && target <= end
  }

  const threadOverlapsYear = (t, year) => {
    const yearStart = qKeyToNum(toQKey(year, 1))
    const yearEnd = qKeyToNum(toQKey(year, 4))
    const start = qKeyToNum(getThreadQStart(t))
    const end = qKeyToNum(getThreadQEnd(t))
    return start <= yearEnd && end >= yearStart
  }

  const matchesTimeFilter = (t) => {
    if (!t.createdAt && !t.updatedAt) return true
    if (filterQuarter) return threadOverlapsQuarter(t, filterYear, filterQuarter)
    return threadOverlapsYear(t, filterYear)
  }

  // Available years from all threads
  const availableYears = [...new Set(
    allT.map(t => new Date(t.createdAt || t.updatedAt).getFullYear())
  )].sort((a, b) => b - a)
  if (!availableYears.includes(filterYear)) availableYears.unshift(filterYear)

  // Count projects per quarter for the selected year
  const quarterCounts = QUARTERS.map(q => {
    const count = projects.filter(t => threadOverlapsQuarter(t, filterYear, q.value)).length
    return { ...q, count }
  })

  // Quarter drag-drop state
  const [quarterAction, setQuarterAction] = useState(null) // { threadId, targetYear, targetQ }

  const handleQuarterDrop = (threadId, targetYear, targetQ) => {
    const thread = allT.find(t => t.id === threadId)
    if (!thread) return
    setQuarterAction({ threadId, thread, targetYear, targetQ })
  }

  const handleQuarterMove = async () => {
    if (!quarterAction) return
    const { threadId, targetYear, targetQ } = quarterAction
    const qKey = toQKey(targetYear, targetQ)
    try {
      await api.updateThread(threadId, { quarterStart: qKey, quarterEnd: null })
      await refresh()
    } catch (e) { showToast(e.message) }
    setQuarterAction(null)
  }

  const handleQuarterSpan = async () => {
    if (!quarterAction) return
    const { threadId, thread, targetYear, targetQ } = quarterAction
    const currentStart = getThreadQStart(thread)
    const currentEnd = getThreadQEnd(thread)
    const target = toQKey(targetYear, targetQ)
    const allKeys = [currentStart, currentEnd, target]
    const nums = allKeys.map(qKeyToNum)
    const newStart = numToQKey(Math.min(...nums))
    const newEnd = numToQKey(Math.max(...nums))
    try {
      await api.updateThread(threadId, { quarterStart: newStart, quarterEnd: newEnd })
      await refresh()
    } catch (e) { showToast(e.message) }
    setQuarterAction(null)
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="loading-dot" />
        Loading...
      </div>
    )
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="header-title">
            <svg className="header-logo" width="28" height="28" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" fill="none">
              <path fill="currentColor" d="M105 25c0 5.34-5.24 11.264-7.723 13.771a1.78 1.78 0 0 1-2.554 0C92.239 36.264 87 30.341 87 25a9 9 0 1 1 18 0ZM87 167c0-5.341 5.24-11.264 7.723-13.771a1.779 1.779 0 0 1 2.554 0C99.761 155.736 105 161.659 105 167a9 9 0 0 1-9 9 9 9 0 0 1-9-9Zm80-62c-5.341 0-11.264-5.24-13.771-7.723a1.779 1.779 0 0 1 0-2.554C155.736 92.239 161.659 87 167 87a9 9 0 0 1 9 9 9 9 0 0 1-9 9ZM25 87c5.34 0 11.264 5.24 13.771 7.723a1.78 1.78 0 0 1 0 2.554C36.264 99.761 30.341 105 25 105a9 9 0 1 1 0-18Zm127.569-34.84c-3.777 3.776-11.67 4.26-15.199 4.277a1.78 1.78 0 0 1-1.806-1.807c.017-3.53.5-11.422 4.277-15.199a9 9 0 1 1 12.728 12.728ZM39.431 139.841c3.777-3.777 11.67-4.26 15.2-4.277a1.78 1.78 0 0 1 1.805 1.806c-.017 3.529-.5 11.422-4.277 15.199a9 9 0 1 1-12.728-12.728Zm100.41 12.728c-3.777-3.777-4.26-11.67-4.277-15.199a1.78 1.78 0 0 1 1.806-1.806c3.529.017 11.422.5 15.199 4.277a9.001 9.001 0 0 1 0 12.728 9.001 9.001 0 0 1-12.728 0ZM52.16 39.431c3.776 3.777 4.26 11.67 4.277 15.2a1.78 1.78 0 0 1-1.807 1.805c-3.53-.017-11.422-.5-15.199-4.277a9 9 0 0 1 0-12.727 9 9 0 0 1 12.728 0Z"/>
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="12" d="m80 96 16 16 32-32"/>
            </svg>
            In Focus
          </h1>
        </div>
        <div className="header-right">
          {inFocusTitle && (
            <button className="last-touched" onClick={handleClickInFocus}>
              <span className="last-touched-dot" />
              {inFocusTitle}
            </button>
          )}
          <button
            className="btn-add"
            onClick={() => { setAddTarget('focus'); setShowAdd(true) }}
          >
            + New Thread
          </button>
          <div className="settings-wrapper">
            <button className="settings-btn" onClick={() => setShowSettings(!showSettings)} title="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {showSettings && (
              <>
                <div className="settings-backdrop" onClick={() => setShowSettings(false)} />
                <div className="settings-popover">
                  <div className="settings-title">Settings</div>
                  <label className="settings-label">OpenAI API Key</label>
                  <input
                    className="settings-input"
                    type="password"
                    value={apiKey}
                    onChange={e => { setApiKeyState(e.target.value); saveApiKey(e.target.value) }}
                    placeholder="sk-..."
                  />
                  <div className="settings-hint">Stored locally in your browser. Used for AI features.</div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Year / Quarter filter bar */}
      <div className="time-filter-bar">
        <div className="time-filter-year-row">
          <select
            className="project-view-year-select"
            value={filterYear}
            onChange={e => {
              const year = Number(e.target.value)
              setFilterYear(year)
              setFilterQuarter(year === new Date().getFullYear() ? currentQuarter : null)
            }}
          >
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <div className="header-week-center">
            Week of {state?.weekLabel || '...'}
            {(() => {
              const now = new Date()
              const currentQ = Math.ceil((now.getMonth() + 1) / 3)
              const quarterEndMonth = currentQ * 3
              const quarterEnd = new Date(now.getFullYear(), quarterEndMonth, 0)
              const diffDays = Math.ceil((quarterEnd - now) / (1000 * 60 * 60 * 24))
              return ` · ${diffDays} days til end of Q${currentQ}`
            })()}
          </div>
        </div>
        <div className="project-view-quarter-filters">
          {quarterCounts.map(q => {
            const isCurrentQ = filterYear === new Date().getFullYear() && q.value === Math.ceil((new Date().getMonth() + 1) / 3)
            return (
              <button
                key={q.value}
                className={`pv-quarter-chip ${filterQuarter === q.value ? 'active' : ''} ${isCurrentQ ? 'current' : ''}`}
                onClick={() => setFilterQuarter(filterQuarter === q.value ? null : q.value)}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('quarter-drag-over') }}
                onDragLeave={e => e.currentTarget.classList.remove('quarter-drag-over')}
                onDrop={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.currentTarget.classList.remove('quarter-drag-over')
                  const threadId = e.dataTransfer.getData('text/plain')
                  if (threadId) handleQuarterDrop(threadId, filterYear, q.value)
                }}
              >
                {q.label}
                <span className="pv-quarter-months">{q.range}</span>
                {q.count > 0 && <span className="pv-quarter-count">{q.count}</span>}
                {isCurrentQ && <span className="pv-quarter-now-dot">📌</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Team Filter */}
      {teams.length > 0 && (
        <div className="team-filter-bar">
          <button
            className={`team-filter-chip ${activeTeamFilter === null ? 'active' : ''}`}
            onClick={() => setActiveTeamFilter(null)}
          >
            All
          </button>
          {teams.map(t => (
            <button
              key={t}
              className={`team-filter-chip ${activeTeamFilter === t ? 'active' : ''}`}
              onClick={() => setActiveTeamFilter(activeTeamFilter === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Projects — with current quarter pulse */}
      {(() => {
        const visibleProjects = projects.filter(matchesTimeFilter).filter(p => !activeTeamFilter || p.team === activeTeamFilter)
        return visibleProjects.length > 0 && (
        <div className="projects-section">
        <div className="stream-header">
          <span className="projects-count-badge">{visibleProjects.length}</span>
          <span className="stream-title">{visibleProjects.length === 1 ? 'Project' : 'Projects'}</span>
          <span className="projects-quarter-badge">{currentQ}</span>
        </div>
        <div className="projects-row">
          {visibleProjects.map(project => {
            // All threads linked to this project (directly or via epics)
            const linkedEpicIds = allT.filter(t => t.linkedTo === project.id && t.category === 'epic').map(e => e.id)
            const projectThreads = allT.filter(t =>
              t.linkedTo === project.id ||
              linkedEpicIds.includes(t.linkedTo)
            ).filter(t => t.category !== 'project' && t.category !== 'epic')

            const currentQNum = Math.ceil((now.getMonth() + 1) / 3)
            const thisQThreads = projectThreads.filter(t => threadOverlapsQuarter(t, now.getFullYear(), currentQNum))
            const totalWins = projectThreads.reduce((n, t) => n + (t.log?.filter(l => l.type === 'win').length || 0), 0)

            return (
              <div
                key={project.id}
                className="project-pill"
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', project.id)
                  e.dataTransfer.setData('source', 'project')
                }}
                onClick={() => navigateTo(project.id)}
              >
                <div className="project-pill-name">{project.title}</div>
                <div className="project-pill-meta">
                  <span className="project-pill-quarter">{currentQ}</span>
                  <span className="project-pill-stat">{thisQThreads.length} thread{thisQThreads.length !== 1 ? 's' : ''}</span>
                  {totalWins > 0 && <span className="project-pill-wins">{totalWins} win{totalWins !== 1 ? 's' : ''}</span>}
                </div>
              </div>
            )
          })}
        </div>
        </div>
      )
      })()}

      {/* Epics — separate from projects */}
      {epics.length > 0 && (
        <div className="epics-row">
          {epics.map(epic => {
            const parentProject = epic.linkedTo ? allT.find(t => t.id === epic.linkedTo) : null
            const childThreads = allT.filter(t => t.linkedTo === epic.id).filter(t => t.category !== 'project' && t.category !== 'epic')
            const thisQChildren = childThreads.filter(t => threadOverlapsQuarter(t, now.getFullYear(), Math.ceil((now.getMonth() + 1) / 3)))

            return (
              <div
                key={epic.id}
                className="epic-pill"
                onClick={() => navigateTo(epic.id)}
              >
                <div className="epic-pill-name">{epic.title}</div>
                <div className="epic-pill-meta">
                  {parentProject && <span className="epic-pill-parent">{parentProject.title}</span>}
                  <span className="epic-pill-stat">{thisQChildren.length} thread{thisQChildren.length !== 1 ? 's' : ''} this Q</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Streams */}
      <div className="streams">
        {/* Focus Column */}
        <div className="focus-column">
          {/* In Focus — single spotlight item */}
          {(() => {
            const workItems = state?.focusThreads?.filter(isWorkItem)?.filter(matchesTimeFilter)?.filter(t => t.status !== 'completed') || []
            // The true #1 spotlight item is always position 0 in the unfiltered list
            const trueInFocus = workItems[0] || null
            // When team-filtered, only show in-focus if it matches the team
            const inFocus = activeTeamFilter
              ? (trueInFocus && trueInFocus.team === activeTeamFilter ? trueInFocus : null)
              : trueInFocus
            // Out of focus: all remaining items (skip #1), filtered by team
            const rest = workItems.slice(1)
            const outOfFocus = activeTeamFilter
              ? rest.filter(t => t.team === activeTeamFilter)
              : rest
            const teamFocusCount = activeTeamFilter
              ? workItems.filter(t => t.team === activeTeamFilter).length
              : workItems.length

            return (
              <>
                <div className="stream-header stream-header-focus">
                  <span className="stream-title">
                    <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                      <path d="M3,5C5.25,5,5.25,7,7.5,7S9.75,5,12,5s2.26,2,4.51,2S18.75,5,21,5" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px', opacity: 0.5 }} />
                      <path d="M21,11c-2.25,0-2.25,2-4.5,2S14.25,11,12,11,9.75,13,7.5,13,5.25,11,3,11" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px' }} />
                      <path d="M21,17c-2.25,0-2.25,2-4.5,2S14.25,17,12,17,9.75,19,7.5,19,5.25,17,3,17" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px', opacity: 0.5 }} />
                    </svg>
                    In Focus
                  </span>
                  {inFocus && inFocus.status !== 'completed' && (
                    <button
                      className="btn-complete-task"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await handleStatusChange(inFocus.id, 'completed')
                      }}
                    >
                      Close the thread
                      <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: 6, verticalAlign: 'middle' }}>
                        <path d="M18,11a3,3,0,0,1,0,6c-1.66,0-5-1.34-5-3S16.34,11,18,11ZM6,11a3,3,0,0,0,0,6c1.66,0,5-1.34,5-3S7.66,11,6,11Zm8,0v6m-2-7v8m-2-1V10.83A6.84,6.84,0,0,0,8,6H8" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px' }} />
                      </svg>
                    </button>
                  )}
                </div>

                {/* In Focus zone */}
                <div
                  className="in-focus-zone"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
                  onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                  onDrop={async e => {
                    e.currentTarget.classList.remove('drag-over')
                    const id = e.dataTransfer.getData('text/plain')
                    const source = e.dataTransfer.getData('source')
                    if (!id) return
                    if (source === 'undercurrent') {
                      // Swap: demote current In Focus to Staged, then promote dropped item
                      const currentInFocusId = inFocus?.id
                      if (currentInFocusId) {
                        await handleDemote(currentInFocusId)
                      }
                      await handlePromote(id)
                      await handleMakeInFocus(id)
                    } else {
                      handleMakeInFocus(id)
                    }
                  }}
                >
                  {inFocus ? (
                    <div
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', inFocus.id)
                        e.dataTransfer.setData('source', 'focus')
                      }}
                    >
                      <ThreadCard
                        thread={inFocus}
                        allThreads={state?.allThreads || []}
                        onClick={() => navigateTo(inFocus.id)}
                      />
                    </div>
                  ) : (
                    <div className="focus-empty">
                      <div className="focus-empty-icon">~</div>
                      <p>{activeTeamFilter
                        ? `No ${activeTeamFilter} items are currently in focus.`
                        : 'Nothing in focus. Drag an item here or add a new thread.'
                      }</p>
                    </div>
                  )}
                </div>

              </>
            )
          })()}
        </div>

        {/* Undercurrent */}
        <div
          className="undercurrent-stream"
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('uc-drag-over') }}
          onDragLeave={e => e.currentTarget.classList.remove('uc-drag-over')}
          onDrop={e => {
            e.currentTarget.classList.remove('uc-drag-over')
            const id = e.dataTransfer.getData('text/plain')
            const source = e.dataTransfer.getData('source')
            if (id && source === 'focus') {
              handleDemote(id)
            }
          }}
        >
          <div className="stream-header">
            <svg className="stream-icon" width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M3,5C5.25,5,5.25,7,7.5,7S9.75,5,12,5s2.26,2,4.51,2S18.75,5,21,5" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px' }} />
              <path d="M21,11c-2.25,0-2.25,2-4.5,2S14.25,11,12,11,9.75,13,7.5,13,5.25,11,3,11" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px' }} />
              <path d="M21,17c-2.25,0-2.25,2-4.5,2S14.25,17,12,17,9.75,19,7.5,19,5.25,17,3,17" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px' }} />
            </svg>
            <span className="stream-title">Staged</span>
            <span className="stream-count">
              {(() => {
                const ucWork = state?.undercurrent?.filter(u => {
                  const t = state?.allThreads?.find(th => th.id === u.id)
                  return t ? (isWorkItem(t) && matchesTimeFilter(t) && t.status !== 'completed') : true
                }) || []
                return activeTeamFilter
                  ? ucWork.filter(u => {
                      const t = state?.allThreads?.find(th => th.id === u.id)
                      return t?.team === activeTeamFilter
                    }).length
                  : ucWork.length
              })()}
            </span>
          </div>
          {(() => {
            const ucWorkItems = state?.undercurrent?.filter(u => {
              const t = state?.allThreads?.find(th => th.id === u.id)
              return t ? (isWorkItem(t) && matchesTimeFilter(t) && t.status !== 'completed') : true
            }) || []
            const filtered = activeTeamFilter
              ? ucWorkItems.filter(u => {
                  const t = state?.allThreads?.find(th => th.id === u.id)
                  return t?.team === activeTeamFilter
                })
              : ucWorkItems
            return filtered?.length > 0 ? (
              filtered.map(item => (
                <div
                  key={item.id}
                  className={`uc-item${displacedThreadId === item.id ? ' uc-displaced' : ''}`}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', item.id)
                    e.dataTransfer.setData('source', 'undercurrent')
                  }}
                  onMouseEnter={() => { if (displacedThreadId === item.id) setDisplacedThreadId(null) }}
                  onClick={() => navigateTo(item.id)}
                >
                  <div className="uc-item-left">
                    {(() => {
                      const fullThread = state?.allThreads?.find(t => t.id === item.id)
                      const linkedProject = fullThread?.linkedTo ? state?.allThreads?.find(t => t.id === fullThread.linkedTo) : null
                      return (fullThread?.team || linkedProject) ? (
                        <div className="uc-item-context">
                          {fullThread?.team && <span className="thread-team-label">{fullThread.team}</span>}
                          {fullThread?.team && linkedProject && <span className="uc-item-sep">·</span>}
                          {linkedProject && (
                            <span className="thread-card-parent-title">{linkedProject.title}</span>
                          )}
                        </div>
                      ) : null
                    })()}
                    <div className="uc-item-title">{item.title}</div>
                    {(() => {
                      const fullThread = state?.allThreads?.find(t => t.id === item.id)
                      return fullThread?.nextAction ? (
                        <div className="thread-card-next">
                          <span className="thread-card-next-arrow">→</span>
                          <svg className="thread-card-next-shoe" viewBox="0 0 800 800" fill="currentColor"><path d="M723.605 329.74C737.916 349.775 733.359 377.856 713.445 392.339L243.389 734.198C235.427 739.99 226.015 743.049 216.168 743.049H97.0789C81.071 743.049 68.0498 730.026 68.0496 714.021C68.0496 707.072 73.6828 701.439 80.6317 701.439H185.889C190.657 701.439 195.306 699.952 199.193 697.191L717.079 328.647C719.183 327.149 722.103 327.639 723.605 329.74Z"/><path d="M672.087 257.622C684.3 274.72 680.318 298.486 663.197 310.669L188.452 648.514C182.018 653.093 174.317 655.553 166.42 655.553H106.05C85.0628 655.553 68.0496 638.54 68.0496 617.553V612.38C68.0496 599.327 76.3703 587.782 88.7527 583.656L175.02 554.899C197.194 547.505 215.164 531.919 225.615 511.017C229.74 502.765 240.737 500.98 247.259 507.504L256.981 517.226C262.253 522.495 269.16 525.131 276.066 525.131C282.972 525.131 289.879 522.494 295.15 517.226C305.69 506.686 305.69 489.598 295.15 479.055L270.063 453.966C263.723 447.625 262.151 437.938 266.161 429.918C272.52 417.199 289.471 414.448 299.526 424.503L324.615 449.592C329.886 454.861 336.794 457.497 343.7 457.497C350.609 457.497 357.513 454.861 362.784 449.592C373.324 439.052 373.324 421.961 362.784 411.421L308.312 356.949C306.055 354.692 305.495 351.243 306.924 348.388C313.332 335.572 316.718 321.226 316.718 306.899C316.718 306.433 317.28 306.2 317.609 306.529L342.256 331.176C347.527 336.445 354.433 339.081 361.34 339.081C368.246 339.081 375.152 336.445 380.424 331.176C390.964 320.636 390.964 303.545 380.424 293.005L327.844 240.423C320.718 233.297 316.715 223.632 316.715 213.554V167.494C316.715 151.956 326.175 137.983 340.602 132.212L501.053 68.0302C517.312 61.5266 535.91 66.9756 546.088 81.225L672.087 257.622Z"/></svg>
                          {fullThread.nextAction}
                        </div>
                      ) : null
                    })()}
                  </div>
                  {(() => {
                    const fullThread = state?.allThreads?.find(t => t.id === item.id)
                    return fullThread?.status && fullThread.status !== 'active' ? (
                      <span className={`badge badge-${fullThread.status}`}>
                        {fullThread.status === 'review' ? 'In Review' : fullThread.status === 'blocked' ? 'Blocked' : fullThread.status === 'completed' ? 'Completed' : fullThread.status === 'dropped' ? 'Dropped' : fullThread.status}
                      </span>
                    ) : null
                  })()}
                  {(() => {
                    const fullThread = state?.allThreads?.find(t => t.id === item.id)
                    return fullThread?.pushToFocus ? (
                      <span className="push-indicator" title={`Pushes to focus ${new Date(fullThread.pushToFocus).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}>
                        ⏰ {new Date(fullThread.pushToFocus).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : null
                  })()}
                  <div className="uc-item-actions">
                    <button
                      className="uc-btn"
                      title="Promote to focus"
                      onClick={e => { e.stopPropagation(); handlePromote(item.id) }}
                    >
                      ↑
                    </button>
                    <button
                      className="uc-btn"
                      title="Move to Out of Focus"
                      onClick={e => { e.stopPropagation(); handleMoveToOutOfFocus(item.id) }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="uc-empty">
                {activeTeamFilter
                  ? `Nothing staged for ${activeTeamFilter}.`
                  : <>Nothing simmering yet.<br />Capture new items as they come.</>
                }
              </div>
            )
          })()}

        </div>
      </div>

      {/* Bottom row: Out of Focus (left) + Closed Loops (right) */}
      <div className="bottom-row">
        {(() => {
          const workItems = state?.focusThreads?.filter(isWorkItem)?.filter(matchesTimeFilter)?.filter(t => t.status !== 'completed') || []
          const rest = workItems.slice(1)
          const outOfFocus = activeTeamFilter ? rest.filter(t => t.team === activeTeamFilter) : rest
          return (
            <div className="out-of-focus">
              <div className="stream-header">
                <svg className="stream-icon" width="16" height="16" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                  <path fill="currentColor" d="M381.86,15.768C356.44,5.599,323.142,0,288.099,0c-35.044,0-68.343,5.599-93.763,15.768 c-43.405,17.363-49.884,42.322-49.884,55.656v114.82l-30.52-15.259c-7.216-3.609-15.785-3.221-22.643,1.018 c-6.862,4.24-11.037,11.733-11.037,19.797v96.299c0,8.816,4.98,16.874,12.865,20.815l51.335,25.668v105.993 c0,13.334,6.482,38.294,49.886,55.656C219.758,506.401,253.055,512,288.099,512c35.042,0,68.341-5.599,93.761-15.766 c43.407-17.363,49.887-42.322,49.887-55.656V71.424C431.748,58.09,425.267,33.131,381.86,15.768z M288.099,46.545 c58.359,0,91.412,16.984,96.715,24.879c-5.305,7.893-38.36,24.875-96.715,24.875c-58.357,0-91.412-16.983-96.715-24.875 C196.687,63.53,229.739,46.545,288.099,46.545z M385.202,439.923c-3.817,7.56-37.072,25.532-97.103,25.532 c-0.272,0-0.534-0.006-0.804-0.008V352.299c0-12.853-10.42-23.273-23.273-23.273c-12.853,0-23.273,10.42-23.273,23.273v108.943 c-30.21-5.784-47.101-16.064-49.754-21.321V320.2c0-8.816-4.98-16.874-12.865-20.815l-51.335-25.668v-44.26l30.52,15.259 c7.215,3.606,15.784,3.219,22.643-1.018c6.862-4.24,11.037-11.731,11.037-19.797v-98.212c1.094,0.469,2.197,0.932,3.34,1.39 c25.42,10.167,58.719,15.766,93.763,15.766c0.268,0,0.535-0.008,0.804-0.008V256c0,12.853,10.42,23.273,23.273,23.273 c12.853,0,23.273-10.42,23.273-23.273V139.267c17.084-2.669,32.873-6.772,46.412-12.187c1.143-0.458,2.248-0.925,3.342-1.39 V439.923z" />
                </svg>
                <span className="stream-title">Out of Focus</span>
                <span className="stream-count">{outOfFocus.length}</span>
                <form className="uc-quick-add oof-quick-add" onSubmit={handleQuickAddUC}>
                  <input
                    type="text"
                    placeholder="Quick capture..."
                    value={ucInput}
                    onChange={e => setUcInput(e.target.value)}
                  />
                  <button type="submit">+</button>
                </form>
              </div>
              <div className="out-of-focus-list">
                {outOfFocus.map((thread, i) => (
                  <div
                    key={thread.id}
                    className="oof-item-wrapper"
                    onDragOver={e => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      const midY = rect.top + rect.height / 2
                      e.currentTarget.classList.remove('oof-drop-above', 'oof-drop-below')
                      e.currentTarget.classList.add(e.clientY < midY ? 'oof-drop-above' : 'oof-drop-below')
                    }}
                    onDragLeave={e => {
                      e.currentTarget.classList.remove('oof-drop-above', 'oof-drop-below')
                    }}
                    onDrop={async e => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.currentTarget.classList.remove('oof-drop-above', 'oof-drop-below')
                      const id = e.dataTransfer.getData('text/plain')
                      const source = e.dataTransfer.getData('source')
                      if (!id) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const midY = rect.top + rect.height / 2
                      const dropAbove = e.clientY < midY
                      const targetIndex = dropAbove ? i + 1 : i + 2
                      if (source === 'undercurrent') {
                        await handlePromote(id)
                        await handleReorderFocus(id, targetIndex)
                      } else {
                        await handleReorderFocus(id, targetIndex)
                      }
                    }}
                  >
                    <div
                      className="oof-item"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', thread.id)
                        e.dataTransfer.setData('source', 'focus')
                      }}
                      onClick={() => navigateTo(thread.id)}
                    >
                      <span className="oof-number">{i + 1}</span>
                      <div className="oof-content">
                        <div className="oof-context">
                          {thread.team && <span className="oof-team">{thread.team}</span>}
                          {thread.team && thread.linkedTo && (() => {
                            const linked = state?.allThreads?.find(t => t.id === thread.linkedTo)
                            return linked ? <><span className="context-sep">·</span><span className="oof-project">{linked.title}</span></> : null
                          })()}
                          {!thread.team && thread.linkedTo && (() => {
                            const linked = state?.allThreads?.find(t => t.id === thread.linkedTo)
                            return linked ? <span className="oof-project">{linked.title}</span> : null
                          })()}
                          {thread.status && thread.status !== 'active' && (
                            <span className={`badge badge-${thread.status}`}>
                              {thread.status === 'review' ? 'In Review' : thread.status === 'blocked' ? 'Blocked' : thread.status === 'completed' ? 'Completed' : thread.status === 'dropped' ? 'Dropped' : thread.status}
                            </span>
                          )}
                        </div>
                        <div className="oof-title">{thread.title}</div>
                      </div>
                      {thread.pushToFocus && (
                        <span className="push-indicator" title={`Pushes to focus ${new Date(thread.pushToFocus).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}>
                          ⏰ {new Date(thread.pushToFocus).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      )}
                      {thread.nextAction && (
                        <span className="oof-next">
                          <span className="thread-card-next-arrow">→</span>
                          <svg className="thread-card-next-shoe" viewBox="0 0 800 800" fill="currentColor"><path d="M723.605 329.74C737.916 349.775 733.359 377.856 713.445 392.339L243.389 734.198C235.427 739.99 226.015 743.049 216.168 743.049H97.0789C81.071 743.049 68.0498 730.026 68.0496 714.021C68.0496 707.072 73.6828 701.439 80.6317 701.439H185.889C190.657 701.439 195.306 699.952 199.193 697.191L717.079 328.647C719.183 327.149 722.103 327.639 723.605 329.74Z"/><path d="M672.087 257.622C684.3 274.72 680.318 298.486 663.197 310.669L188.452 648.514C182.018 653.093 174.317 655.553 166.42 655.553H106.05C85.0628 655.553 68.0496 638.54 68.0496 617.553V612.38C68.0496 599.327 76.3703 587.782 88.7527 583.656L175.02 554.899C197.194 547.505 215.164 531.919 225.615 511.017C229.74 502.765 240.737 500.98 247.259 507.504L256.981 517.226C262.253 522.495 269.16 525.131 276.066 525.131C282.972 525.131 289.879 522.494 295.15 517.226C305.69 506.686 305.69 489.598 295.15 479.055L270.063 453.966C263.723 447.625 262.151 437.938 266.161 429.918C272.52 417.199 289.471 414.448 299.526 424.503L324.615 449.592C329.886 454.861 336.794 457.497 343.7 457.497C350.609 457.497 357.513 454.861 362.784 449.592C373.324 439.052 373.324 421.961 362.784 411.421L308.312 356.949C306.055 354.692 305.495 351.243 306.924 348.388C313.332 335.572 316.718 321.226 316.718 306.899C316.718 306.433 317.28 306.2 317.609 306.529L342.256 331.176C347.527 336.445 354.433 339.081 361.34 339.081C368.246 339.081 375.152 336.445 380.424 331.176C390.964 320.636 390.964 303.545 380.424 293.005L327.844 240.423C320.718 233.297 316.715 223.632 316.715 213.554V167.494C316.715 151.956 326.175 137.983 340.602 132.212L501.053 68.0302C517.312 61.5266 535.91 66.9756 546.088 81.225L672.087 257.622Z"/></svg>
                          {thread.nextAction}
                        </span>
                      )}
                      <button
                        className="oof-focus-btn"
                        title="Make in focus"
                        onClick={e => { e.stopPropagation(); handleMakeInFocus(thread.id) }}
                      >
                        ↑
                      </button>
                    </div>
                  </div>
                ))}
                <div
                  className="oof-drop-end"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
                  onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                  onDrop={async e => {
                    e.currentTarget.classList.remove('drag-over')
                    const id = e.dataTransfer.getData('text/plain')
                    const source = e.dataTransfer.getData('source')
                    if (!id) return
                    if (source === 'undercurrent') {
                      await handlePromote(id)
                    } else {
                      handleMoveOutOfFocus(id)
                    }
                  }}
                >
                  {outOfFocus.length === 0
                    ? <div className="oof-empty">Drop items here</div>
                    : <div className="oof-end-zone" />
                  }
                </div>
              </div>
            </div>
          )
        })()}
        <div className="closed-loops-section">
          <div className="stream-header">
            {(() => {
              const closedCount = allT.filter(t => t.status === 'completed' && isWorkItem(t) && matchesTimeFilter(t)).filter(t => !activeTeamFilter || t.team === activeTeamFilter).length
              return (
                <>
                  <svg className="stream-icon" width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18,11a3,3,0,0,1,0,6c-1.66,0-5-1.34-5-3S16.34,11,18,11ZM6,11a3,3,0,0,0,0,6c1.66,0,5-1.34,5-3S7.66,11,6,11Zm8,0v6m-2-7v8m-2-1V10.83A6.84,6.84,0,0,0,8,6H8" style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2px' }} />
                  </svg>
                  <span className="stream-title">
                    {closedCount === 1 ? 'Thread Closed' : 'Threads Closed'}
                  </span>
                  <span className="stream-count">{closedCount}</span>
                </>
              )
            })()}
          </div>
          {(() => {
            const completedItems = allT
              .filter(t => t.status === 'completed' && isWorkItem(t) && matchesTimeFilter(t))
              .filter(t => !activeTeamFilter || t.team === activeTeamFilter)
            return completedItems.length > 0 ? (
              <div className="out-of-focus-list">
                {completedItems.map(thread => (
                  <div
                    key={thread.id}
                    className="oof-item"
                    onClick={() => navigateTo(thread.id)}
                  >
                    <span className="oof-number oof-check">✓</span>
                    <div className="oof-content">
                      <div className="oof-context">
                        {thread.team && <span className="oof-team">{thread.team}</span>}
                        {thread.team && thread.linkedTo && (() => {
                          const linked = state?.allThreads?.find(t => t.id === thread.linkedTo)
                          return linked ? <><span className="context-sep">·</span><span className="oof-project">{linked.title}</span></> : null
                        })()}
                        {!thread.team && thread.linkedTo && (() => {
                          const linked = state?.allThreads?.find(t => t.id === thread.linkedTo)
                          return linked ? <span className="oof-project">{linked.title}</span> : null
                        })()}
                      </div>
                      <div className="oof-title">{thread.title}</div>
                    </div>
                    <span className="oof-next">
                      {new Date(thread.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="uc-empty">No threads closed yet.</div>
            )
          })()}
        </div>
      </div>

      {/* Project View — quarter-based timeline */}
      {selectedThread && selectedThread.category === 'project' && !editingProject && (
        <ProjectView
          project={selectedThread}
          allThreads={state?.allThreads || []}
          onClose={() => navStack.length > 1 ? navigateBack() : navigateClose()}
          onSelectThread={(id) => navigateTo(id)}
          onEditProject={() => setEditingProject(true)}
          navStack={navStack}
          allNavThreads={state?.allThreads || []}
          onBreadcrumbNav={(index) => { setNavAction('back'); setNavStack(prev => prev.slice(0, index + 1)) }}
          panelWidth={panelWidth}
          onResizeStart={handleResizeStart}
          navAction={navAction}
          closing={panelClosing}
        />
      )}

      {/* Thread Detail Panel */}
      {selectedThread && (selectedThread.category !== 'project' || editingProject) && (
        <ThreadDetail
          thread={selectedThread}
          onClose={() => navStack.length > 1 ? navigateBack() : navigateClose()}
          onUpdate={(data) => handleUpdateThread(selectedThread.id, data)}
          onAddLog={(entry) => handleAddLog(selectedThread.id, entry)}
          onDeleteLog={(logId) => handleDeleteLog(selectedThread.id, logId)}
          onEditLog={(logId, data) => handleEditLog(selectedThread.id, logId, data)}
          onDemote={() => handleDemote(selectedThread.id)}
          onDelete={() => handleDelete(selectedThread.id)}
          onEvolve={(data) => handleEvolveThread(selectedThread.id, data)}
          onStatusChange={(status) => handleStatusChange(selectedThread.id, status)}
          isFocus={state?.focusOrder?.includes(selectedThread.id)}
          teams={teams}
          people={people}
          allThreads={state?.allThreads || []}
          onBackToProject={editingProject ? () => setEditingProject(false) : navStack.length > 1 ? () => navigateBack() : null}
          navStack={navStack}
          allNavThreads={state?.allThreads || []}
          onBreadcrumbNav={(index) => { setNavAction('back'); setNavStack(prev => prev.slice(0, index + 1)) }}
          panelWidth={panelWidth}
          onResizeStart={handleResizeStart}
          navAction={navAction}
          closing={panelClosing}
        />
      )}

      {/* Add Modal */}
      {showAdd && (
        <AddModal
          target={addTarget}
          onClose={() => setShowAdd(false)}
          onSubmit={handleAddThread}
          focusCount={state?.focusOrder?.length || 0}
          teams={teams}
        />
      )}

      {/* Quarter Action Modal */}
      {quarterAction && (
        <QuarterActionModal
          thread={quarterAction.thread}
          targetYear={quarterAction.targetYear}
          targetQ={quarterAction.targetQ}
          onMove={handleQuarterMove}
          onSpan={handleQuarterSpan}
          onClose={() => setQuarterAction(null)}
        />
      )}

      {/* Staged Replace Modal */}
      {stagedReplaceModal && (
        <div className="modal-overlay" onClick={() => setStagedReplaceModal(null)}>
          <div className="staged-replace-modal" onClick={e => e.stopPropagation()}>
            <h3>Staged is full</h3>
            <p>You can only have {STAGED_MAX} items staged. Choose one to replace:</p>
            <div className="staged-replace-list">
              {getStagedItems().map(item => {
                const fullThread = state?.allThreads?.find(t => t.id === item.id)
                return (
                  <button
                    key={item.id}
                    className="staged-replace-item"
                    onClick={async () => {
                      await stagedReplaceModal.pendingAction(item.id)
                      setStagedReplaceModal(null)
                    }}
                  >
                    <span className="staged-replace-title">{fullThread?.title || item.title}</span>
                    {fullThread?.team && <span className="staged-replace-team">{fullThread.team}</span>}
                  </button>
                )
              })}
            </div>
            <button className="staged-replace-cancel" onClick={() => setStagedReplaceModal(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
