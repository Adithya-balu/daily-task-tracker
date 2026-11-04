import type { AgentMap, Effect } from './agentTypes'
import type {
  BrainDumpItem,
  DailyStats,
  PomodoroSettings,
  Project,
  Task,
  TimeBlock,
} from './types'

/** Required by the local server on every state-changing request. */
const GUARD_HEADER = { 'X-Daily-Focus': '1' }

type RequestOptions = {
  method?: string
  body?: unknown
  /** Lets the request finish after the page is closed (body must stay under ~64KB). */
  keepalive?: boolean
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const hasBody = opts.body !== undefined
  const body = hasBody ? JSON.stringify(opts.body) : undefined
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...GUARD_HEADER, ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
    body,
    keepalive: Boolean(opts.keepalive && body && body.length < 60_000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
  }
  return data as T
}

export type StateKey =
  | 'tasks'
  | 'projects'
  | 'brainDump'
  | 'settings'
  | 'dailyStats'
  | 'timeBlocks'

export type InitialState = {
  initialized: boolean
  tasks: Task[] | null
  projects: Project[] | null
  brainDump: BrainDumpItem[] | null
  settings: PomodoroSettings | null
  dailyStats: DailyStats | null
  timeBlocks: TimeBlock[] | null
  /** Revision of each file; saves must send the one they were based on. */
  revs: Record<StateKey, number>
  agents: AgentMap
  effects: Effect[]
}

/** Error thrown for HTTP failures; `status` 409 means another tab saved first. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type LiveState = { agents: AgentMap; effects: Effect[] }
