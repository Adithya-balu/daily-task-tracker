export type Priority = 'high' | 'medium' | 'low'
export type TaskStatus = 'todo' | 'in_progress' | 'done'

export type SessionLogKind = 'note' | 'claude' | 'terminal'

export type SessionLogEntry = {
  at: number
  text: string
  /** Who produced the entry; older entries without it are your own pause notes. */
  kind?: SessionLogKind
  runId?: string
}

export type ReferenceKind = 'url' | 'path' | 'snippet'

/** A link, local file/folder, or pasted text attached to a task or project. */
export type Reference = {
  id: string
  kind: ReferenceKind
  label: string
  value: string
  /** Whether this reference is sent to Claude as context. */
  includeInContext: boolean
  createdAt: number
}

export type PlanStepStatus = 'todo' | 'doing' | 'done'
export type PlanOwner = 'me' | 'claude'

export type PlanStep = {
  id: string
  text: string
  status: PlanStepStatus
  owner: PlanOwner
}

export type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** Permission mode used when Claude actually does the work (after an optional plan). */
export type ExecuteMode = 'acceptEdits' | 'auto'

/**
 * Claude run settings. On a project these are defaults; on a task, any field
 * that is set overrides the project's value.
 */
export type ClaudeConfig = {
  workingDir?: string
  model?: ClaudeModel
  effort?: ClaudeEffort
  /** Start in read-only plan mode and wait for approval before editing. */
  planFirst?: boolean
  executeMode?: ExecuteMode
  /** Space-separated tool rules passed to --allowedTools, e.g. "Bash(npm test)". */
  allowedTools?: string
  maxBudgetUsd?: number
  useWorktree?: boolean
}

export type Project = {
  id: string
  name: string
  workingDir: string
  /** Standing instructions appended to every Claude run in this project. */
  rules: string
  references: Reference[]
  claude: ClaudeConfig
  /** Test & lint command for workflow `ci` stages ({{project.ciCommand}}). */
  ciCommand?: string
  createdAt: number
}

export type Task = {
  id: string
  title: string
  priority: Priority
  status: TaskStatus
  /** Private free-form notes; only sent to Claude when opted in. */
  notes: string
  /** Ordered implementation steps; this is what Claude works from. */
  plan: PlanStep[]
  references: Reference[]
  projectId: string | null
  /** Per-task overrides of the project's Claude settings. */
  claude: ClaudeConfig
  /** Include private notes in the prompt sent to Claude. */
  shareNotesWithClaude: boolean
  /** Workflow (workflows/<id>.json) this task runs through; unset = manual Claude runs only. */
  workflowId?: string
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

/**
 * A scheduled slot on the day planner. Linked to a task when `taskId` is set
 * (the block then shows the task's title); otherwise a free block such as a
 * meeting or lunch, named by `title`.
 */
export type TimeBlock = {
  id: string
  taskId: string | null
  title: string
  /** YYYY-MM-DD of the day the block is planned on. */
  dayKey: string
  /** Minutes from midnight, local time. `endMin` is exclusive and at most 1440. */
  startMin: number
  endMin: number
  createdAt: number
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

/** Activity accrued on a calendar day (not lifetime task totals). */
export type DailyStats = {
  dayKey: string
  pomodoros: number
  focusedSeconds: number
  claudeRuns?: number
  claudeTokens?: number
  claudeCostUsd?: number
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  breakMinutes: 5,
}

export const DEFAULT_CLAUDE_CONFIG: Required<Omit<ClaudeConfig, 'maxBudgetUsd' | 'effort'>> &
  Pick<ClaudeConfig, 'maxBudgetUsd' | 'effort'> = {
  workingDir: '',
  model: 'sonnet',
  planFirst: true,
  executeMode: 'acceptEdits',
  allowedTools: '',
  useWorktree: false,
}

export const CLAUDE_MODELS: ClaudeModel[] = ['haiku', 'sonnet', 'opus', 'fable']
export const CLAUDE_EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

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
