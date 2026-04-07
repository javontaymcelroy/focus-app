const STORAGE_KEY = 'focus_ui_sizes'

function getAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

export function getPersistedSize(key) {
  return getAll()[key] ?? null
}

export function persistSize(key, value) {
  const all = getAll()
  all[key] = value
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}
