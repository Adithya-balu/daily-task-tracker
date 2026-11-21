import { api, type InitialState, type StateKey } from './api'
import {
  DEFAULT_POMODORO_SETTINGS,
  type BrainDumpItem,
  type DailyStats,
  type PomodoroSettings,
  type Task,
} from './types'

/** Reads a value saved by older versions of the app, which used localStorage. */
export function loadLocalJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** localStorage keys from before data moved to the local server. Kept as a backup. */
export const LEGACY_STORAGE_KEYS: Partial<Record<StateKey, string>> = {
  tasks: 'daily-focus.tasks',
  brainDump: 'daily-focus.brainDump',
  settings: 'daily-focus.settings',
  dailyStats: 'daily-focus.dailyStats',
}

/** Small browser-only preferences that don't need to live on the server. */
export const PREF_KEYS = {
  lastProjectId: 'daily-focus.pref.lastProjectId',
} as const

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function savePref(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage unavailable - preferences are optional.
  }
}

/** Set once this browser's old localStorage data has been merged into the server. */
const MERGED_FLAG = 'daily-focus.mergedToServer'

function mergeById<T extends { id: string }>(server: T[], legacy: T[]): T[] {
  const ids = new Set(server.map((x) => x.id))
  return [...server, ...legacy.filter((x) => !ids.has(x.id))]
}

/**
 * Loads app state from the local server. Each browser (or container tab) that
 * still has data from the old localStorage version merges it in once: items
 * the server doesn't have yet are added; nothing on the server is replaced.
 * localStorage itself is left untouched as a backup.
 */
export async function loadInitialState(): Promise<InitialState> {
  const state = await api<InitialState>('/state')
  if (loadPref(MERGED_FLAG)) return state

  const { tasks: tasksKey, brainDump: dumpKey, settings: settingsKey, dailyStats: statsKey } =
    LEGACY_STORAGE_KEYS as Record<string, string>
  const legacyTasks = loadLocalJSON<Task[] | null>(tasksKey, null)
  const legacyDump = loadLocalJSON<BrainDumpItem[] | null>(dumpKey, null)
  const legacySettings = loadLocalJSON<PomodoroSettings | null>(settingsKey, null)
  const legacyStats = loadLocalJSON<DailyStats | null>(statsKey, null)

  const merged: InitialState = { ...state, initialized: true }
  const writes: [StateKey, unknown][] = []

  const serverTasks = state.tasks ?? []
  const tasks = mergeById(serverTasks, legacyTasks ?? [])
  if (!state.initialized || tasks.length !== serverTasks.length) {
    merged.tasks = tasks
    writes.push(['tasks', tasks])
  }

  const serverDump = state.brainDump ?? []
  const dump = mergeById(serverDump, legacyDump ?? [])
  if (dump.length !== serverDump.length) {
    merged.brainDump = dump
    writes.push(['brainDump', dump])
  }

  // Keep timer settings someone chose on the server; only replace the defaults.
  const s = state.settings
  const serverIsDefault =
    !s ||
    (s.workMinutes === DEFAULT_POMODORO_SETTINGS.workMinutes &&
      s.breakMinutes === DEFAULT_POMODORO_SETTINGS.breakMinutes)
  if (legacySettings && serverIsDefault) {
    merged.settings = legacySettings
    writes.push(['settings', legacySettings])
  }

  if (legacyStats && !state.dailyStats) {
    merged.dailyStats = legacyStats
    writes.push(['dailyStats', legacyStats])
  }

  merged.revs = { ...state.revs }
  for (const [key, value] of writes) {
    const { rev } = await api<{ rev: number }>(`/state/${key}?rev=${merged.revs[key] ?? 0}`, {
      method: 'PUT',
      body: value,
    })
    merged.revs[key] = rev
  }
  savePref(MERGED_FLAG, '1')
  return merged
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
