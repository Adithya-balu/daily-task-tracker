/**
 * Types shared by the browser and the local API server (server/). Keep this
 * file free of DOM or Node imports.
 */
import type { ClaudeConfig, SessionLogEntry } from './types'
import type { WorkflowRun } from './workflowTypes'

export type AgentStatus =
  | 'idle'
  | 'running'
  /** Plan ready; waiting for you to approve. */
  | 'awaiting_review'
  /** Claude finished executing; review the result. */
  | 'done'
  | 'failed'
  | 'in_terminal'
  | 'interrupted'

export type RunMode = 'plan' | 'execute'

export type TokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type RunSummary = {
  id: string
  mode: RunMode
  model: string | null
  startedAt: number
  endedAt: number | null
  resultText: string
  usage: TokenUsage
  costUsd: number
  numTurns: number
  durationMs: number
  permissionDenials: number
  isError: boolean
  /** True when this entry was synced from a terminal session, not an app run. */
  fromTerminal?: boolean
}

/** Server-owned Claude state for one task (stored in data/agent.json). */
export type AgentState = {
  status: AgentStatus
  sessionId: string | null
  /** Directory the session lives in (differs from workingDir when using a worktree). */
  cwd: string | null
  activeRunId: string | null
  /** Mode of the active or most recent run. */
  lastMode: RunMode | null
  error: string | null
  terminalOpenedAt: number | null
  /** Where the session is open while status is 'in_terminal'. */
  openedIn?: 'terminal' | 'vscode' | null
  runs: RunSummary[]
  totals: TokenUsage & { costUsd: number; runs: number }
}

export type AgentMap = Record<string, AgentState>

/** Structured result Claude is asked to return at the end of every run. */
export type StructuredResult = {
  summary: string
  nextStep: string
  filesChanged?: string[]
  planSteps?: string[]
}

/**
 * A change to client-owned data (tasks / daily stats) requested by the server.
 * The browser applies it through its normal store and acknowledges it on the
 * next save of `target`, so effects survive the tab being closed mid-run.
 */
export type Effect =
  | { id: string; target: 'tasks'; kind: 'log'; taskId: string; entry: SessionLogEntry }
  | { id: string; target: 'tasks'; kind: 'resumeNote'; taskId: string; text: string }
  | { id: string; target: 'tasks'; kind: 'plan'; taskId: string; steps: string[] }
  | {
      id: string
      target: 'dailyStats'
      kind: 'stats'
      dayKey: string
      runs: number
      tokens: number
      costUsd: number
    }

export type RunRequest = {
  prompt: string
  mode: RunMode
  config: ClaudeConfig
  title: string
  /** Extra directories (folder references) Claude may read. */
  addDirs: string[]
  appendSystemPrompt: string
  /** Continue the task's existing session instead of starting a new one. */
  resume: boolean
  /** With resume: branch into a new session id. */
  fork: boolean
}

/** Omit that keeps each member of a union distinct. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Messages on the global /api/events stream. */
export type ServerEvent =
  | { type: 'agent'; taskId: string; state: AgentState }
  | { type: 'effect'; effect: Effect }
  /** A task's workflow runs changed (newest first). */
  | { type: 'workflow'; taskId: string; runs: WorkflowRun[] }

/** Simplified run-log line sent on /api/runs/:id/events. */
export type RunLogLine =
  | { kind: 'text'; at: number; text: string }
  | { kind: 'tool'; at: number; name: string; detail: string }
  | { kind: 'tool_result'; at: number; text: string; isError: boolean }
  | { kind: 'system'; at: number; text: string }
  | { kind: 'end'; at: number }

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

export function emptyAgentState(): AgentState {
  return {
    status: 'idle',
    sessionId: null,
    cwd: null,
    activeRunId: null,
    lastMode: null,
    error: null,
    terminalOpenedAt: null,
    runs: [],
    totals: { ...emptyUsage(), costUsd: 0, runs: 0 },
  }
}
