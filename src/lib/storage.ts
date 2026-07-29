/** Small typed wrapper around localStorage with JSON (de)serialization. */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable - fail silently for a personal tool.
  }
}

export const STORAGE_KEYS = {
  tasks: 'daily-focus.tasks',
  brainDump: 'daily-focus.brainDump',
  settings: 'daily-focus.settings',
} as const

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
