import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_POMODORO_SETTINGS,
  PRIORITY_ORDER,
  type BrainDumpItem,
  type PomodoroSettings,
  type Priority,
  type Task,
  type TaskStatus,
} from '../lib/types'
import { STORAGE_KEYS, loadJSON, saveJSON, uid } from '../lib/storage'
import { dayKeyOf } from '../lib/time'

/** Backfills fields added in later versions so older stored tasks stay valid. */
function normalizeTask(t: Task): Task {
  return { ...t, notes: t.notes ?? '' }
}

/**
 * Rolls unfinished tasks forward to today so they never get lost.
 * Done tasks keep their original day (they belong to history).
 */
function rolloverTasks(tasks: Task[], today: string): Task[] {
  return tasks.map((t) => {
    const base = normalizeTask(t)
    if (base.status !== 'done' && base.dayKey !== today) {
      return { ...base, dayKey: today }
    }
    return base
  })
}

/**
 * Persists `value` to localStorage, but coalesces rapid changes (e.g. typing in
 * notes) into a single write after `delay`. Flushes immediately when the tab is
 * hidden or closed so nothing is lost.
 */
function useDebouncedSave<T>(key: string, value: T, delay = 400) {
  const valueRef = useRef(value)
  valueRef.current = value
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      saveJSON(key, valueRef.current)
      timerRef.current = null
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [key, value, delay])

  useEffect(() => {
    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      saveJSON(key, valueRef.current)
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
  }, [key])
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

export function useTasks() {
  const today = dayKeyOf()

  const [tasks, setTasks] = useState<Task[]>(() =>
    rolloverTasks(loadJSON<Task[]>(STORAGE_KEYS.tasks, []), today),
  )
  const [brainDump, setBrainDump] = useState<BrainDumpItem[]>(() =>
    loadJSON<BrainDumpItem[]>(STORAGE_KEYS.brainDump, []),
  )
  const [settings, setSettings] = useState<PomodoroSettings>(() =>
    loadJSON<PomodoroSettings>(STORAGE_KEYS.settings, DEFAULT_POMODORO_SETTINGS),
  )

  useDebouncedSave(STORAGE_KEYS.tasks, tasks)
  useDebouncedSave(STORAGE_KEYS.brainDump, brainDump)
  useDebouncedSave(STORAGE_KEYS.settings, settings)

  // Re-run rollover when the day changes while the app stays open overnight.
  const dayRef = useRef(today)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = dayKeyOf()
      if (now !== dayRef.current) {
        dayRef.current = now
        setTasks((prev) => rolloverTasks(prev, now))
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  const addTask = useCallback((title: string, priority: Priority): Task => {
    const task: Task = {
      id: uid(),
      title: title.trim(),
      priority,
      status: 'todo',
      notes: '',
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
  }, [])

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /**
   * Moves a task to `status` and positions it in the shared task array so it
   * renders just before `beforeId` in its column (or at the column's end when
   * `beforeId` is null). This is the single source of truth for board order.
   */
  const reorderTask = useCallback(
    (draggedId: string, status: TaskStatus, beforeId: string | null) => {
      if (draggedId === beforeId) return
      setTasks((prev) => {
        const dragged = prev.find((t) => t.id === draggedId)
        if (!dragged) return prev
        const updated: Task = {
          ...dragged,
          status,
          completedAt:
            status === 'done' ? dragged.completedAt ?? Date.now() : null,
        }
        const without = prev.filter((t) => t.id !== draggedId)

        let insertIndex: number
        if (beforeId) {
          insertIndex = without.findIndex((t) => t.id === beforeId)
          if (insertIndex === -1) insertIndex = without.length
        } else {
          // Append after the last task currently in the target column.
          let last = -1
          without.forEach((t, i) => {
            if (t.status === status) last = i
          })
          insertIndex = last === -1 ? without.length : last + 1
        }
        return [...without.slice(0, insertIndex), updated, ...without.slice(insertIndex)]
      })
    },
    [],
  )

  const setStatus = useCallback((id: string, status: TaskStatus) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              completedAt: status === 'done' ? Date.now() : null,
            }
          : t,
      ),
    )
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
          ? { ...t, sessionLog: [...t.sessionLog, { at: Date.now(), text: trimmed }] }
          : t,
      ),
    )
  }, [])

  const addFocusedSeconds = useCallback((id: string, seconds: number) => {
    if (seconds <= 0) return
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, focusedSeconds: t.focusedSeconds + Math.round(seconds) } : t,
      ),
    )
  }, [])

  const incrementPomodoro = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, pomodorosCompleted: t.pomodorosCompleted + 1 } : t,
      ),
    )
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

  return {
    today,
    tasks,
    brainDump,
    settings,
    setSettings,
    addTask,
    updateTask,
    deleteTask,
    reorderTask,
    setStatus,
    setResumeNote,
    setNotes,
    appendSessionLog,
    addFocusedSeconds,
    incrementPomodoro,
    addDump,
    removeDump,
    promoteDump,
  }
}

export type UseTasks = ReturnType<typeof useTasks>
