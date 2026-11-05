import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import {
  emptyAgentState,
  emptyUsage,
  totalTokens,
  type AgentMap,
  type AgentState,
  type DistributiveOmit,
  type Effect,
  type RunLogLine,
  type RunRequest,
  type RunSummary,
  type ServerEvent,
  type StructuredResult,
  type TokenUsage,
} from '../src/lib/agentTypes'
import type { Store } from './store'

/** JSON schema for the structured result every run must end with. */
const RESULT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What was done in this run, 1-3 sentences.' },
    nextStep: {
      type: 'string',
      description: 'The single next thing to do when resuming this task. Empty if finished.',
    },
    filesChanged: { type: 'array', items: { type: 'string' } },
    planSteps: {
      type: 'array',
      items: { type: 'string' },
      description: 'In plan mode: the ordered implementation steps, one short line each.',
    },
  },
  required: ['summary', 'nextStep'],
})

const MAX_RUNS_KEPT = 50

type ActiveRun = {
  id: string
  taskId: string
  mode: RunSummary['mode']
  child: ChildProcess
  startedAt: number
  lines: RunLogLine[]
  subscribers: Set<(line: RunLogLine) => void>
  logFile: string
  stderr: string
  result: Record<string, unknown> | null
  stopped: boolean
  /** Task was deleted mid-run: discard the result. */
  forgotten: boolean
  killTimer: ReturnType<typeof setTimeout> | null
  /** Workflow stage runs leave the task's interactive session alone. */
  headless: boolean
  sessionId: string | null
  onClose: (run: ActiveRun, code: number | null) => void
}

/** A one-off session for a workflow stage (see server/workflow/). */
export type HeadlessRequest = {
  prompt: string
  cwd: string
  title: string
  permissionMode: string
  allowedTools: string[]
  disallowedTools: string[]
  jsonSchema: string
  model?: string
  effort?: string
  maxBudgetUsd?: number
  appendSystemPrompt?: string
  addDirs: string[]
  /** Continue this session instead of starting a fresh one (output retries). */
  resumeSessionId?: string
  env: NodeJS.ProcessEnv
}

export type HeadlessResult = {
  runId: string
  sessionId: string | null
  structured: unknown
  isError: boolean
  error: string | null
  usage: TokenUsage
  costUsd: number
  durationMs: number
  numTurns: number
  model: string | null
}

/** Returns why manual runs are blocked for a task, or null. */
export type RunGuard = (taskId: string) => string | null

export class AgentHub {
  private agents: AgentMap
  private effects: Effect[]
  private listeners = new Set<(e: ServerEvent) => void>()
  private active = new Map<string, ActiveRun>()
  private readonly store: Store
  private guard: RunGuard = () => null

  constructor(store: Store) {
    this.store = store
    this.agents = store.read<AgentMap>('agent', {})
    this.effects = store.read<Effect[]>('pendingEffects', [])

    // Runs can't survive a server restart; surface them instead of leaving
    // tasks stuck on "running".
    let changed = false
    for (const [taskId, a] of Object.entries(this.agents)) {
      if (a.status === 'running') {
        this.agents[taskId] = {
          ...a,
          status: 'interrupted',
          activeRunId: null,
          error: 'The app server restarted while this run was in progress.',
        }
        changed = true
      }
    }
    if (changed) this.persistAgents()
  }

  // ---- state & events ----

  getAgents(): AgentMap {
    return this.agents
  }

  getEffects(): Effect[] {
    return this.effects
  }

  subscribe(fn: (e: ServerEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  ackEffects(ids: string[]): void {
    if (ids.length === 0) return
    const drop = new Set(ids)
    const next = this.effects.filter((e) => !drop.has(e.id))
    if (next.length !== this.effects.length) {
      this.effects = next
      this.store.write('pendingEffects', this.effects)
    }
  }

  private broadcast(e: ServerEvent): void {
    for (const fn of this.listeners) fn(e)
  }

  private persistAgents(): void {
    this.store.write('agent', this.agents)
  }

  private agent(taskId: string): AgentState {
    return this.agents[taskId] ?? emptyAgentState()
  }

  setAgent(taskId: string, patch: Partial<AgentState>): AgentState {
    const state = { ...this.agent(taskId), ...patch }
    this.agents[taskId] = state
    this.persistAgents()
    this.broadcast({ type: 'agent', taskId, state })
    return state
  }

  emitEffect(effect: DistributiveOmit<Effect, 'id'>): void {
    const full = { ...effect, id: randomUUID() } as Effect
    this.effects.push(full)
    this.store.write('pendingEffects', this.effects)
    this.broadcast({ type: 'effect', effect: full })
  }

  /** User dismissed a finished/failed/interrupted state. */
  acknowledge(taskId: string): void {
    const a = this.agent(taskId)
    if (a.status === 'running' || a.status === 'in_terminal') return
    this.setAgent(taskId, { status: 'idle', error: null })
  }

  // ---- runs ----

  /** Lets the workflow engine block manual runs on tasks it is driving. */
  setRunGuard(guard: RunGuard): void {
    this.guard = guard
  }

  startRun(taskId: string, req: RunRequest): string {
    const agent = this.agent(taskId)
    if (agent.status === 'running') throw new HttpError(409, 'A run is already in progress.')
    if (agent.status === 'in_terminal') {
      throw new HttpError(409, 'This task is open in Terminal. Close it (or click "I\'m back") first.')
    }
    const blocked = this.guard(taskId)
    if (blocked) throw new HttpError(409, blocked)

    let cwd: string
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--json-schema', RESULT_SCHEMA]

    if (req.resume) {
      if (!agent.sessionId || !agent.cwd) throw new HttpError(400, 'No previous session to continue.')
      cwd = agent.cwd
      args.push('--resume', agent.sessionId)
      if (req.fork) args.push('--fork-session')
    } else {
      cwd = resolveDir(req.config.workingDir)
      args.push('--session-id', randomUUID())
      if (req.config.useWorktree) args.push('--worktree', `daily-focus-${taskId.slice(0, 8)}`)
    }
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new HttpError(400, `Working folder not found: ${cwd}`)
    }

    const c = req.config
    if (c.model) args.push('--model', c.model)
    if (c.effort) args.push('--effort', c.effort)
    args.push('--permission-mode', req.mode === 'plan' ? 'plan' : (c.executeMode ?? 'acceptEdits'))
    const tools = (c.allowedTools ?? '')
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (tools.length) args.push('--allowedTools', tools.join(','))
    if (c.maxBudgetUsd && c.maxBudgetUsd > 0) args.push('--max-budget-usd', String(c.maxBudgetUsd))
    if (req.title) args.push('--name', req.title.slice(0, 80))
    if (req.appendSystemPrompt) args.push('--append-system-prompt', req.appendSystemPrompt)
    args.push(...addDirArgs(req.addDirs, cwd))

    const run = this.launch(taskId, req.mode, args, cwd, req.prompt, process.env, false, (r, code) =>
      this.finishRun(r, code),
    )
    this.setAgent(taskId, {
      status: 'running',
      activeRunId: run.id,
      lastMode: req.mode,
      error: null,
      // A new session forgets the old one until init reports the new id.
      ...(req.resume ? {} : { sessionId: null, cwd }),
    })
    return run.id
  }

  /**
   * Runs a fresh (or resumed) headless session for a workflow stage. Its log
   * is stored and streamed like any other run, but it doesn't touch the task's
   * own Claude session or status. `done` settles when the process exits.
   */
  runHeadless(taskId: string, req: HeadlessRequest): { runId: string; done: Promise<HeadlessResult> } {
    if (!fs.existsSync(req.cwd) || !fs.statSync(req.cwd).isDirectory()) {
      throw new HttpError(400, `Working folder not found: ${req.cwd}`)
    }
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--json-schema', req.jsonSchema]
    if (req.resumeSessionId) args.push('--resume', req.resumeSessionId)
    else args.push('--session-id', randomUUID())
    if (req.model) args.push('--model', req.model)
    if (req.effort) args.push('--effort', req.effort)
    args.push('--permission-mode', req.permissionMode)
    if (req.allowedTools.length) args.push('--allowedTools', req.allowedTools.join(','))
    if (req.disallowedTools.length) args.push('--disallowedTools', req.disallowedTools.join(','))
    if (req.maxBudgetUsd && req.maxBudgetUsd > 0) args.push('--max-budget-usd', req.maxBudgetUsd.toFixed(2))
    if (req.title) args.push('--name', req.title.slice(0, 80))
    if (req.appendSystemPrompt) args.push('--append-system-prompt', req.appendSystemPrompt)
    args.push(...addDirArgs(req.addDirs, req.cwd))

    let resolve!: (r: HeadlessResult) => void
    const done = new Promise<HeadlessResult>((r) => (resolve = r))
    const mode = req.permissionMode === 'plan' ? 'plan' : 'execute'
    const run = this.launch(taskId, mode, args, req.cwd, req.prompt, req.env, true, (r, code) => {
      const p = parseRun(r, code)
      for (const fn of r.subscribers) fn({ kind: 'end', at: Date.now() })
      r.subscribers.clear()
      resolve({
        runId: r.id,
        sessionId: r.sessionId,
        structured: p.isError ? null : p.structured,
        isError: p.isError,
        error: r.forgotten ? 'Task deleted.' : p.errorText,
        usage: p.usage,
        costUsd: p.costUsd,
        durationMs: p.durationMs,
        numTurns: p.numTurns,
        model: p.model,
      })
    })
    return { runId: run.id, done }
  }

  /** Stops one run by id (used to cancel workflow stages). */
  stopRun(runId: string): void {
    const run = this.active.get(runId)
    if (!run) return
    run.stopped = true
    run.child.kill('SIGINT')
    run.killTimer = setTimeout(() => run.child.kill('SIGTERM'), 3000)
  }

  private launch(
    taskId: string,
    mode: RunSummary['mode'],
    args: string[],
    cwd: string,
    prompt: string,
    env: NodeJS.ProcessEnv,
    headless: boolean,
    onClose: ActiveRun['onClose'],
  ): ActiveRun {
    const runId = randomUUID()
    const child = spawn(claudeBin(), args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const run: ActiveRun = {
      id: runId,
      taskId,
      mode,
      child,
      startedAt: Date.now(),
      lines: [],
      subscribers: new Set(),
      logFile: this.store.runLogPath(taskId, runId),
      stderr: '',
      result: null,
      stopped: false,
      forgotten: false,
      killTimer: null,
      headless,
      sessionId: null,
      onClose,
    }
    this.active.set(runId, run)
    fs.writeFileSync(run.logFile, '')

    child.stdin?.end(prompt)
    child.stderr?.on('data', (d: Buffer) => {
      run.stderr = (run.stderr + d.toString()).slice(-4000)
    })
    const rl = readline.createInterface({ input: child.stdout! })
    rl.on('line', (line) => this.onLine(run, line))
    child.on('error', (err) => {
      run.stderr += `\n${err.message}`
    })
    child.on('close', (code) => {
      rl.close()
      if (run.killTimer) clearTimeout(run.killTimer)
      this.active.delete(run.id)
      run.onClose(run, code)
    })
    return run
  }

  stop(taskId: string): void {
    const runId = this.agent(taskId).activeRunId
    const run = runId ? this.active.get(runId) : undefined
    if (!run) return
    run.stopped = true
    run.child.kill('SIGINT')
    run.killTimer = setTimeout(() => run.child.kill('SIGTERM'), 3000)
  }

  /** Task deleted: stop any run and drop its Claude state and logs. */
  forget(taskId: string): void {
    for (const run of this.active.values()) {
      if (run.taskId !== taskId) continue
      run.forgotten = true
      run.child.kill('SIGTERM')
    }
    if (this.agents[taskId]) {
      delete this.agents[taskId]
      this.persistAgents()
    }
    const before = this.effects.length
    this.effects = this.effects.filter((e) => e.target !== 'tasks' || e.taskId !== taskId)
    if (this.effects.length !== before) this.store.write('pendingEffects', this.effects)
    this.store.removeRunLogs(taskId)
  }

  /** Streams a run's log: replays what happened so far, then follows live. */
  subscribeRun(taskId: string, runId: string, fn: (line: RunLogLine) => void): () => void {
    const run = this.active.get(runId)
    if (run) {
      for (const line of run.lines) fn(line)
      run.subscribers.add(fn)
      return () => run.subscribers.delete(fn)
    }
    // Finished run: rebuild the simplified log from the raw transcript file.
    try {
      const raw = fs.readFileSync(this.store.runLogPath(taskId, runId), 'utf8')
      for (const l of raw.split('\n')) {
        if (!l.trim()) continue
        try {
          for (const line of toLogLines(JSON.parse(l))) fn(line)
        } catch {
          // skip malformed line
        }
      }
    } catch {
      fn({ kind: 'system', at: Date.now(), text: 'No log saved for this run.' })
    }
    fn({ kind: 'end', at: Date.now() })
    return () => {}
  }

  shutdown(): void {
    for (const run of this.active.values()) run.child.kill('SIGTERM')
  }

  private onLine(run: ActiveRun, line: string): void {
    if (!line.trim()) return
    fs.appendFileSync(run.logFile, line + '\n')
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'system' && msg.subtype === 'init' && run.headless) {
      run.sessionId = (msg.session_id as string) ?? null
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      this.setAgent(run.taskId, {
        sessionId: (msg.session_id as string) ?? null,
        cwd: (msg.cwd as string) ?? null,
      })
    }
    if (msg.type === 'result') run.result = msg
    for (const l of toLogLines(msg)) {
      run.lines.push(l)
      for (const fn of run.subscribers) fn(l)
    }
  }

  private finishRun(run: ActiveRun, code: number | null): void {
    if (run.forgotten) {
      for (const fn of run.subscribers) fn({ kind: 'end', at: Date.now() })
      return
    }

    const r = run.result
    const parsed = parseRun(run, code)
    const { usage, isError, errorText } = parsed
    const structured = parsed.structured as StructuredResult | null

    const summary: RunSummary = {
      id: run.id,
      mode: run.mode,
      model: parsed.model,
      startedAt: run.startedAt,
      endedAt: Date.now(),
      resultText: structured?.summary ?? (typeof r?.result === 'string' ? r.result : errorText ?? ''),
      usage,
      costUsd: parsed.costUsd,
      numTurns: parsed.numTurns,
      durationMs: parsed.durationMs,
      permissionDenials: Array.isArray(r?.permission_denials) ? r.permission_denials.length : 0,
      isError,
    }

    const prev = this.agent(run.taskId)
    const runs = [summary, ...prev.runs].slice(0, MAX_RUNS_KEPT)
    this.setAgent(run.taskId, {
      status: run.stopped ? 'idle' : isError ? 'failed' : run.mode === 'plan' ? 'awaiting_review' : 'done',
      activeRunId: null,
      error: run.stopped ? null : errorText,
      runs,
      totals: {
        input: prev.totals.input + usage.input,
        output: prev.totals.output + usage.output,
        cacheRead: prev.totals.cacheRead + usage.cacheRead,
        cacheWrite: prev.totals.cacheWrite + usage.cacheWrite,
        costUsd: prev.totals.costUsd + summary.costUsd,
        runs: prev.totals.runs + 1,
      },
    })

    const label = run.mode === 'plan' ? 'Claude planned' : 'Claude worked'
    this.emitEffect({
      target: 'tasks',
      kind: 'log',
      taskId: run.taskId,
      entry: {
        at: Date.now(),
        kind: 'claude',
        runId: run.id,
        text: isError
          ? `${label}: ${errorText ?? 'run failed'}`
          : `${label}: ${summary.resultText || 'done'}`,
      },
    })
    if (!isError && structured) {
      const next = structured.nextStep?.trim()
      if (next && !/^(none|n\/a|nothing)\b/i.test(next)) {
        this.emitEffect({ target: 'tasks', kind: 'resumeNote', taskId: run.taskId, text: next })
      }
      if (run.mode === 'plan' && structured.planSteps?.length) {
        this.emitEffect({ target: 'tasks', kind: 'plan', taskId: run.taskId, steps: structured.planSteps })
      }
    }
    this.emitEffect({
      target: 'dailyStats',
      kind: 'stats',
      dayKey: dayKey(),
      runs: 1,
      tokens: totalTokens(usage),
      costUsd: summary.costUsd,
    })

    for (const fn of run.subscribers) fn({ kind: 'end', at: Date.now() })
    run.subscribers.clear()
  }
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Reads usage, cost and the structured result off a finished run. */
function parseRun(run: ActiveRun, code: number | null) {
  const r = run.result
  const usageRaw = (r?.usage ?? {}) as Record<string, number>
  const usage: TokenUsage = r
    ? {
        input: usageRaw.input_tokens ?? 0,
        output: usageRaw.output_tokens ?? 0,
        cacheRead: usageRaw.cache_read_input_tokens ?? 0,
        cacheWrite: usageRaw.cache_creation_input_tokens ?? 0,
      }
    : emptyUsage()
  const isError = run.stopped || !r || Boolean(r.is_error) || r.subtype !== 'success'
  const errorText = run.stopped
    ? 'Stopped by you.'
    : !r
      ? `Claude exited (code ${code}) without a result. ${run.stderr.trim().slice(-600)}`
      : r.subtype !== 'success'
        ? `Run ended: ${String(r.subtype)}${r.result ? ` - ${String(r.result).slice(0, 300)}` : ''}`
        : null
  return {
    usage,
    structured: (r?.structured_output ?? null) as unknown,
    isError,
    errorText,
    // Record what actually ran: the CLI may substitute models (e.g. in plan mode).
    model: r?.modelUsage ? Object.keys(r.modelUsage as object).join(', ') : null,
    costUsd: Number(r?.total_cost_usd ?? 0),
    numTurns: Number(r?.num_turns ?? 0),
    durationMs: Number(r?.duration_ms ?? Date.now() - run.startedAt),
  }
}

/** File references give Claude access to their folder; bad paths are skipped. */
function addDirArgs(refs: string[], cwd: string): string[] {
  const args: string[] = []
  for (const ref of refs) {
    try {
      const resolved = resolveDir(ref)
      if (!fs.existsSync(resolved)) continue
      const dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved)
      if (!dir.startsWith(cwd)) args.push('--add-dir', dir)
    } catch {
      // not an absolute path; Claude can still try to read it relative to cwd
    }
  }
  return args
}

/** Turns one stream-json message into the simplified lines the UI shows. */
export function toLogLines(msg: Record<string, unknown>): RunLogLine[] {
  const at = Date.now()
  const out: RunLogLine[] = []
  if (msg.type === 'system' && msg.subtype === 'init') {
    out.push({ kind: 'system', at, text: `Session started · ${msg.model} · ${msg.cwd}` })
  } else if (msg.type === 'assistant' || msg.type === 'user') {
    const content = ((msg.message as { content?: unknown })?.content ?? []) as Array<
      Record<string, unknown>
    >
    if (!Array.isArray(content)) return out
    for (const block of content) {
      // User-role text is the CLI's own injected prompts, not something to show.
      if (msg.type === 'assistant' && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        out.push({ kind: 'text', at, text: block.text })
      } else if (block.type === 'tool_use') {
        if (block.name === 'StructuredOutput') continue
        out.push({ kind: 'tool', at, name: String(block.name), detail: describeToolInput(block.input) })
      } else if (block.type === 'tool_result') {
        const text = toolResultText(block.content)
        if (text === 'Structured output provided successfully') continue
        out.push({ kind: 'tool_result', at, text: text.slice(0, 400), isError: Boolean(block.is_error) })
      }
    }
  } else if (msg.type === 'result') {
    out.push({
      kind: 'system',
      at,
      text: `Finished (${msg.subtype}) · ${msg.num_turns} turns · $${Number(msg.total_cost_usd ?? 0).toFixed(3)}`,
    })
  }
  return out
}

function describeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const i = input as Record<string, unknown>
  const pick = i.file_path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? i.query ?? i.path
  if (typeof pick === 'string') return pick.slice(0, 200)
  return JSON.stringify(i).slice(0, 200)
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('\n')
  }
  return ''
}

export function resolveDir(dir: string | undefined): string {
  const d = (dir ?? '').trim()
  if (!d) throw new HttpError(400, 'Set a working folder for this task or its project first.')
  const expanded = d.startsWith('~') ? path.join(os.homedir(), d.slice(1)) : d
  if (!path.isAbsolute(expanded)) throw new HttpError(400, `Working folder must be an absolute path: ${d}`)
  return path.normalize(expanded)
}

let cachedBin: string | null = null

/** launchd gives the dev server a minimal PATH, so look in the usual install spots. */
export function claudeBin(): string {
  if (cachedBin) return cachedBin
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(os.homedir(), '.local/bin/claude'),
    path.join(os.homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ].filter((p): p is string => Boolean(p))
  cachedBin = candidates.find((p) => fs.existsSync(p)) ?? 'claude'
  return cachedBin
}

function dayKey(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}
