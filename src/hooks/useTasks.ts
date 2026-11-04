import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_POMODORO_SETTINGS,
  PRIORITY_ORDER,
  type BrainDumpItem,
  type ClaudeConfig,
  type DailyStats,
  type PlanStep,
  type PomodoroSettings,
  type Priority,
  type Project,
  type Reference,
  type Task,
  type TaskStatus,
  type TimeBlock,
} from '../lib/types'
import type { Effect } from '../lib/agentTypes'
import { ApiError, api, type InitialState, type StateKey } from '../lib/api'
import { uid } from '../lib/storage'
import { dayKeyOf } from '../lib/time'

/** Backfills fields added in later versions so older stored tasks stay valid. */
function normalizeTask(t: Task): Task {
  return {
    ...t,
    notes: t.notes ?? '',
    plan: t.plan ?? [],
    references: t.references ?? [],
    projectId: t.projectId ?? null,
    claude: t.claude ?? {},
    shareNotesWithClaude: t.shareNotesWithClaude ?? false,
    sessionLog: (t.sessionLog ?? []).map((e) => ({ ...e, kind: e.kind ?? 'note' })),
  }
}

function normalizeTasks(tasks: Task[]): Task[] {
  return tasks.map(normalizeTask)
}

type SaveErrorHandler = (key: StateKey, message: string | null) => void

/** Shown when another tab or browser saved newer data; saving here stops. */
export const CONFLICT_MESSAGE = 'conflict'

/**
 * Saves `value` to the local server, coalescing rapid changes (e.g. typing in
 * notes) into one write after `delay`. Flushes immediately when the tab is
 * hidden or closed so nothing is lost. `acks` holds ids of server effects
 * already applied to `value`; they ride along so the server drops them only
 * once the change is safely stored.
 */
function useDebouncedSave<T>(
  key: StateKey,
  value: T,
  initialRev: number,
  onError: SaveErrorHandler,
  acks?: React.RefObject<Set<string>>,
  delay = 400,
) {
  const valueRef = useRef(value)
  valueRef.current = value
  // Last value known to be on the server; unchanged state is never re-saved
  // (render-identity check, so it also holds under StrictMode's double effects).
  const savedRef = useRef(value)
  const revRef = useRef(initialRev)
  const conflictRef = useRef(false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Serialize writes so an older save can never land after a newer one.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  const save = useCallback(
    (keepalive: boolean) => {
      const send = () => {
        // Once another tab has saved newer data, this tab must reload first.
        if (conflictRef.current) return Promise.resolve()
        const body = valueRef.current
        if (body === savedRef.current) return Promise.resolve()
        const ids = acks ? [...acks.current] : []
        const ack = ids.length ? `&ack=${ids.map(encodeURIComponent).join(',')}` : ''
        return api<{ rev: number }>(`/state/${key}?rev=${revRef.current}${ack}`, {
          method: 'PUT',
          body,
          keepalive,
        }).then(
          ({ rev }) => {
            revRef.current = rev
            savedRef.current = body
            ids.forEach((id) => acks?.current.delete(id))
            onErrorRef.current(key, null)
          },
          (err: unknown) => {
            if (err instanceof ApiError && err.status === 409) {
              conflictRef.current = true
              onErrorRef.current(key, CONFLICT_MESSAGE)
            } else {
              onErrorRef.current(key, err instanceof Error ? err.message : String(err))
            }
          },
        )
      }
      if (keepalive) void send()
      else chainRef.current = chainRef.current.then(send)
    },
    [key, acks],
  )

  useEffect(() => {
    if (value === savedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      save(false)
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delay, save])

  useEffect(() => {
    const flush = () => {
      if (!timerRef.current) return
      clearTimeout(timerRef.current)
      timerRef.current = null
      save(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [save])
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // in_progress first, then by priority, then by creation time.
    if (a.status !== b.status) {
      if (a.status === 'in_progress') return -1
      if (b.status === 'in_progress') return 1
    }
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (p !== 0) return p
    return a.createdAt - b.createdAt
  })
}

function emptyDailyStats(dayKey: string): DailyStats {
  return { dayKey, pomodoros: 0, focusedSeconds: 0 }
}

/** Use stored day stats only if they're from today. */
function todayStatsFrom(stored: DailyStats | null, today: string): DailyStats {
  if (stored && stored.dayKey === today) return stored
  return emptyDailyStats(today)
}

/**
 * Current local day as state, so a tab left open past midnight re-renders on
 * its own: checked every minute and whenever the tab regains focus (timers are
 * throttled in background tabs, and a sleeping laptop skips them entirely).
 */
function useToday(): string {
  const [today, setToday] = useState(dayKeyOf)
  useEffect(() => {
    const check = () => setToday((prev) => {
      const now = dayKeyOf()
      return now === prev ? prev : now
    })
    const id = setInterval(check, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return today
}

export function useTasks(initial: InitialState) {
  const today = useToday()

  const [tasks, setTasks] = useState<Task[]>(() => normalizeTasks(initial.tasks ?? []))
  const [projects, setProjects] = useState<Project[]>(() => initial.projects ?? [])
  const [brainDump, setBrainDump] = useState<BrainDumpItem[]>(() => initial.brainDump ?? [])
  const [settings, setSettings] = useState<PomodoroSettings>(
    () => initial.settings ?? DEFAULT_POMODORO_SETTINGS,
  )
  const [dailyStats, setDailyStats] = useState<DailyStats>(() =>
    todayStatsFrom(initial.dailyStats, today),
  )
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>(() => initial.timeBlocks ?? [])

  // Last save error per file; any non-null value shows a banner.
  const [saveErrors, setSaveErrors] = useState<Partial<Record<StateKey, string>>>({})
  const onSaveError = useCallback<SaveErrorHandler>((key, message) => {
    setSaveErrors((prev) => {
      if ((prev[key] ?? null) === message) return prev
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }, [])

  // Server effects applied locally, waiting to be acknowledged by a save.
  const taskAcks = useRef(new Set<string>())
  const statsAcks = useRef(new Set<string>())
  const appliedEffects = useRef(new Set<string>())

  const revs = initial.revs ?? {}
  useDebouncedSave('tasks', tasks, revs.tasks ?? 0, onSaveError, taskAcks)
  useDebouncedSave('projects', projects, revs.projects ?? 0, onSaveError)
  useDebouncedSave('brainDump', brainDump, revs.brainDump ?? 0, onSaveError)
  useDebouncedSave('settings', settings, revs.settings ?? 0, onSaveError)
  useDebouncedSave('dailyStats', dailyStats, revs.dailyStats ?? 0, onSaveError, statsAcks)
  useDebouncedSave('timeBlocks', timeBlocks, revs.timeBlocks ?? 0, onSaveError)

  // If the calendar day changes while the app stays open, start a fresh day bucket.
  useEffect(() => {
    if (dailyStats.dayKey !== today) {
      setDailyStats(emptyDailyStats(today))
    }
  }, [today, dailyStats.dayKey])

  const addTask = useCallback(
    (title: string, priority: Priority, projectId: string | null = null): Task => {
      const task: Task = {
        id: uid(),
        title: title.trim(),
        priority,
        status: 'todo',
        notes: '',
        plan: [],
        references: [],
        projectId,
        claude: {},
        shareNotesWithClaude: false,
        resumeNote: '',
        sessionLog: [],
        pomodorosCompleted: 0,
        focusedSeconds: 0,
        createdAt: Date.now(),
        completedAt: null,
        dayKey: dayKeyOf(),
      }
      setTasks((prev) => [...prev, task])
      return task
    },
    [],
  )

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    // Planned slots for a task that no longer exists have nothing to point at.
    setTimeBlocks((prev) => prev.filter((b) => b.taskId !== id))
  }, [])

  /**
   * Moves a task to `status` and positions it in the shared task array so it
   * renders just before `beforeId` in its column (or at the column's end when
   * `beforeId` is null). This is the single source of truth for board order.
   */
  const reorderTask = useCallback(
    (draggedId: string, status: TaskStatus, beforeId: string | null) => {
      if (draggedId === beforeId) return
      const today = dayKeyOf()
      setTasks((prev) => {
        const dragged = prev.find((t) => t.id === draggedId)
        if (!dragged) return prev
        const updated: Task = {
          ...dragged,
          status,
          // Completing stamps today; restoring / moving active work also lands on today.
          dayKey: today,
          completedAt:
            status === 'done' ? dragged.completedAt ?? Date.now() : null,
        }
        const without = prev.filter((t) => t.id !== draggedId)

        let insertIndex: number
        if (beforeId) {
          insertIndex = without.findIndex((t) => t.id === beforeId)
          if (insertIndex === -1) insertIndex = without.length
        } else {
          // Append after the last task currently in the target column for today.
          let last = -1
          without.forEach((t, i) => {
            if (t.status === status && t.dayKey === today) last = i
          })
          insertIndex = last === -1 ? without.length : last + 1
        }
        return [...without.slice(0, insertIndex), updated, ...without.slice(insertIndex)]
      })
    },
    [],
  )

  const setStatus = useCallback((id: string, status: TaskStatus) => {
    const today = dayKeyOf()
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              dayKey: today,
              completedAt: status === 'done' ? Date.now() : null,
            }
          : t,
      ),
    )
  }, [])

  /** Bring a historical done task back onto today's board as To do. */
  const restoreToToday = useCallback((id: string) => {
    const today = dayKeyOf()
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id)
      if (!task) return prev
      const updated: Task = {
        ...task,
        status: 'todo',
        dayKey: today,
        completedAt: null,
      }
      const without = prev.filter((t) => t.id !== id)
      return [...without, updated]
    })
  }, [])

  const setTitle = useCallback((id: string, title: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)))
  }, [])

  const setResumeNote = useCallback((id: string, resumeNote: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, resumeNote } : t)))
  }, [])

  const setNotes = useCallback((id: string, notes: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, notes } : t)))
  }, [])

  const appendSessionLog = useCallback((id: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              sessionLog: [...t.sessionLog, { at: Date.now(), text: trimmed, kind: 'note' as const }],
            }
          : t,
      ),
    )
  }, [])

  const addFocusedSeconds = useCallback((id: string, seconds: number) => {
    if (seconds <= 0) return
    const add = Math.round(seconds)
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, focusedSeconds: t.focusedSeconds + add } : t,
      ),
    )
    // Also credit the calendar-day summary (separate from per-task lifetime totals).
    const day = dayKeyOf()
    setDailyStats((prev) => {
      const base = prev.dayKey === day ? prev : emptyDailyStats(day)
      return { ...base, focusedSeconds: base.focusedSeconds + add }
    })
  }, [])

  const incrementPomodoro = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, pomodorosCompleted: t.pomodorosCompleted + 1 } : t,
      ),
    )
    const day = dayKeyOf()
    setDailyStats((prev) => {
      const base = prev.dayKey === day ? prev : emptyDailyStats(day)
      return { ...base, pomodoros: base.pomodoros + 1 }
    })
  }, [])

  const setPlan = useCallback((id: string, plan: PlanStep[]) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, plan } : t)))
  }, [])

  const setReferences = useCallback((id: string, references: Reference[]) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, references } : t)))
  }, [])

  const setTaskProject = useCallback((id: string, projectId: string | null) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, projectId } : t)))
  }, [])

  /** Merges overrides; a field set to undefined goes back to inheriting. */
  const setTaskClaudeConfig = useCallback((id: string, patch: Partial<ClaudeConfig>) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const claude: ClaudeConfig = { ...t.claude, ...patch }
        for (const k of Object.keys(claude) as (keyof ClaudeConfig)[]) {
          if (claude[k] === undefined) delete claude[k]
        }
        return { ...t, claude }
      }),
    )
  }, [])

  const setShareNotes = useCallback((id: string, shareNotesWithClaude: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, shareNotesWithClaude } : t)))
  }, [])

  // ---- Projects ----
  const addProject = useCallback((name: string): Project => {
    const project: Project = {
      id: uid(),
      name: name.trim() || 'Untitled project',
      workingDir: '',
      rules: '',
      references: [],
      claude: {},
      createdAt: Date.now(),
    }
    setProjects((prev) => [...prev, project])
    return project
  }, [])

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setTasks((prev) => prev.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)))
  }, [])

  // ---- Effects pushed by the local server (Claude runs) ----
  const applyEffect = useCallback((effect: Effect) => {
    if (appliedEffects.current.has(effect.id)) return
    appliedEffects.current.add(effect.id)
    if (effect.target === 'dailyStats') {
      statsAcks.current.add(effect.id)
      setDailyStats((prev) => {
        const day = dayKeyOf()
        const base = prev.dayKey === day ? prev : emptyDailyStats(day)
        // A run that finished on an earlier day doesn't count toward today.
        if (effect.dayKey !== day) return { ...base }
        return {
          ...base,
          claudeRuns: (base.claudeRuns ?? 0) + effect.runs,
          claudeTokens: (base.claudeTokens ?? 0) + effect.tokens,
          claudeCostUsd: (base.claudeCostUsd ?? 0) + effect.costUsd,
        }
      })
      return
    }
    taskAcks.current.add(effect.id)
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== effect.taskId) return t
        switch (effect.kind) {
          case 'log':
            return { ...t, sessionLog: [...t.sessionLog, effect.entry] }
          case 'resumeNote':
            return { ...t, resumeNote: effect.text }
          case 'plan':
            return {
              ...t,
              plan: effect.steps.map((text) => ({
                id: uid(),
                text,
                status: 'todo' as const,
                owner: 'claude' as const,
              })),
            }
        }
      }),
    )
  }, [])

  // ---- Time blocks (day planner) ----
  const addBlock = useCallback((block: Omit<TimeBlock, 'id' | 'createdAt'>): TimeBlock => {
    const created: TimeBlock = { ...block, id: uid(), createdAt: Date.now() }
    setTimeBlocks((prev) => [...prev, created])
    return created
  }, [])

  const updateBlock = useCallback((id: string, patch: Partial<TimeBlock>) => {
    setTimeBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  const deleteBlock = useCallback((id: string) => {
    setTimeBlocks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  // ---- Brain dump ----
  const addDump = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setBrainDump((prev) => [{ id: uid(), text: trimmed, createdAt: Date.now() }, ...prev])
  }, [])

  const removeDump = useCallback((id: string) => {
    setBrainDump((prev) => prev.filter((d) => d.id !== id))
  }, [])

  const promoteDump = useCallback(
    (id: string, priority: Priority) => {
      setBrainDump((prev) => {
        const item = prev.find((d) => d.id === id)
        if (item) addTask(item.text, priority)
        return prev.filter((d) => d.id !== id)
      })
    },
    [addTask],
  )

  // Expose stats for the current calendar day only (zeros if the bucket rolled).
  const todayStats =
    dailyStats.dayKey === today ? dailyStats : emptyDailyStats(today)

  return {
    today,
    todayStats,
    saveErrors,
    tasks,
    projects,
    brainDump,
    settings,
    timeBlocks,
    setSettings,
    addTask,
    updateTask,
    deleteTask,
    reorderTask,
    setStatus,
    restoreToToday,
    setTitle,
    setResumeNote,
    setNotes,
    appendSessionLog,
    setPlan,
    setReferences,
    setTaskProject,
    setTaskClaudeConfig,
    setShareNotes,
    addProject,
    updateProject,
    deleteProject,
    applyEffect,
    addBlock,
    updateBlock,
    deleteBlock,
    addFocusedSeconds,
    incrementPomodoro,
    addDump,
    removeDump,
    promoteDump,
  }
}

export type UseTasks = ReturnType<typeof useTasks>
