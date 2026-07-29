export type Priority = 'high' | 'medium' | 'low'
export type TaskStatus = 'todo' | 'in_progress' | 'done'

export type SessionLogEntry = {
  at: number
  text: string
}

export type Task = {
  id: string
  title: string
  priority: Priority
  status: TaskStatus
  /** Free-form details / implementation plan for the task. */
  notes: string
  /** "Next step when I return" - shown prominently so you can resume instantly. */
  resumeNote: string
  /** Timestamped log of what was accomplished, appended on each pause. */
  sessionLog: SessionLogEntry[]
  pomodorosCompleted: number
  /** Total focused seconds accumulated across all pomodoro sessions. */
  focusedSeconds: number
  createdAt: number
  completedAt: number | null
  /** YYYY-MM-DD key of the day the task belongs to (used for daily rollover). */
  dayKey: string
}

export type BrainDumpItem = {
  id: string
  text: string
  createdAt: number
}

export type PomodoroSettings = {
  workMinutes: number
  breakMinutes: number
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  breakMinutes: 5,
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
