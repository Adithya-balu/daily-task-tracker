import {
  emptyUsage,
  totalTokens,
  type DistributiveOmit,
  type Effect,
  type TokenUsage,
} from '../../src/lib/agentTypes'
import { dayKeyOf } from '../../src/lib/time'
import {
  DONE,
  gateView,
  isActiveRun,
  type AgentModeDef,
  type AgentStageDef,
  type CommandStageDef,
  type EscalationReason,
  type LoopSummary,
  type StageRecord,
  type StageType,
  type Ticket,
  type WorkflowRun,
  type WorkflowRunMap,
  type WorkflowSummary,
} from '../../src/lib/workflowTypes'
import { startStage, type WorkflowConfig } from './config'
import { buildRetryPrompt, buildStagePrompt, buildStageSystemPrompt } from './prompts'
import { decideOutcome, parseVerdict } from './verdict'

const MAX_RUNS_KEPT = 10
/** How much command output is kept on a stage record. */
const OUTPUT_TAIL = 8000
const CI_PLACEHOLDER = /\{\{\s*project\.ciCommand\s*\}\}/g
const USES_CI = /\{\{\s*project\.ciCommand\s*\}\}/

export class WorkflowError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type AgentStageRequest = {
  taskId: string
  stage: string
  prompt: string
  systemPrompt: string
  cwd: string
  mode: AgentModeDef
  ticket: Ticket
  maxBudgetUsd: number
  /** Set on the output retry: continue the stage's own session. */
  resumeSessionId?: string
  signal: AbortSignal
  /** Called as soon as the run has an id, so its log can be watched live. */
  onStart: (runId: string) => void
}

export type AgentStageResult = {
  runId: string
  sessionId: string | null
  output: unknown
  /** Set when the session itself failed (crash, stopped, non-success result). */
  error: string | null
  usage: TokenUsage
  costUsd: number
}

export type CommandResult = { exitCode: number; output: string }

/** Everything the engine does to the outside world. Fakes make it testable. */
export type EnginePorts = {
  loadConfig(): WorkflowConfig
  runAgent(req: AgentStageRequest): Promise<AgentStageResult>
  runCommand(cmd: string, cwd: string, signal: AbortSignal): Promise<CommandResult>
  /** Resolves and checks a working folder; throws if it isn't usable. */
  resolveDir(dir: string): string
  git: {
    /** Requires a clean git repo; creates and checks out `branch` from HEAD. */
    prepareBranch(cwd: string, branch: string): Promise<{ baseRef: string }>
    /** Commits all changes; false when there was nothing to commit. */
    commitAll(cwd: string, message: string): Promise<boolean>
    diff(cwd: string, baseRef: string): Promise<{ stat: string; patch: string }>
  }
  writeDiff(taskId: string, recordId: string, patch: string): void
  loadRuns(): WorkflowRunMap
  saveRuns(runs: WorkflowRunMap): void
  emit(taskId: string, runs: WorkflowRun[]): void
  emitEffect(effect: DistributiveOmit<Effect, 'id'>): void
  now(): number
  newId(): string
}

/**
 * Drives tasks through workflows. Agents never call each other: the engine
 * starts each stage, reads its verdict and picks the next stage from the
 * workflow's transitions. All state lives on the WorkflowRun and is saved
 * after every step.
 */
export class WorkflowEngine {
  private runs: WorkflowRunMap
  private readonly ports: EnginePorts
  private aborts = new Map<string, AbortController>()
  private loops = new Map<string, Promise<void>>()
  /** Folders a start is currently preparing (before the run exists). */
  private starting = new Set<string>()

  constructor(ports: EnginePorts) {
    this.ports = ports
    this.runs = ports.loadRuns()

    // Stage processes can't survive a server restart; let you resume instead.
    let changed = false
    for (const runs of Object.values(this.runs)) {
      const run = runs[0]
      if (run?.status !== 'running') continue
      run.status = 'interrupted'
      for (const r of run.stages) {
        if (r.status === 'running') this.finish(r, 'failed', { error: 'The app server restarted during this stage.' })
      }
      changed = true
    }
    if (changed) ports.saveRuns(this.runs)
  }

  getRuns(): WorkflowRunMap {
    return this.runs
  }

  /** Workflow files as they are on disk now, with validation errors. */
  listWorkflows(): WorkflowSummary[] {
    return this.ports.loadConfig().summaries
  }

  latest(taskId: string): WorkflowRun | undefined {
    return this.runs[taskId]?.[0]
  }

  /** Why manual Claude runs are blocked for a task, or null. */
  guard(taskId: string): string | null {
    return isActiveRun(this.latest(taskId))
      ? 'A workflow is driving this task. Cancel it on the Workflow tab to run Claude manually.'
      : null
  }

  /** Resolves when the task's current step loop has stopped (for tests). */
  settled(taskId: string): Promise<void> {
    return this.loops.get(taskId) ?? Promise.resolve()
  }

  // ---- commands ----

  async start(taskId: string, workflowId: string, ticket: Ticket): Promise<WorkflowRun> {
    if (isActiveRun(this.latest(taskId))) throw new WorkflowError(409, 'A workflow is already running on this task.')
    const config = this.ports.loadConfig()
    const entry = config.workflows[workflowId]
    if (!entry) throw new WorkflowError(404, `Unknown workflow: ${workflowId}`)
    if (entry.errors.length) {
      throw new WorkflowError(400, `Workflow "${workflowId}" is invalid: ${entry.errors.join('; ')}`)
    }
    const def = entry.def
    const usesCi = Object.values(def.stages).some((s) => s.type === 'command' && USES_CI.test(s.run))
    if (usesCi && !ticket.ciCommand.trim()) {
      throw new WorkflowError(400, 'Set a test & lint command on the project first.')
    }

    let cwd: string
    try {
      cwd = this.ports.resolveDir(ticket.workingDir)
    } catch (err) {
      throw new WorkflowError(400, message(err))
    }
    this.checkFolderFree(cwd, taskId)
    const id = this.ports.newId()
    const branch = `daily-focus/${slug(ticket.title)}-${id.slice(0, 6)}`
    let baseRef: string
    this.starting.add(cwd)
    try {
      baseRef = (await this.ports.git.prepareBranch(cwd, branch)).baseRef
    } catch (err) {
      throw new WorkflowError(400, message(err))
    } finally {
      this.starting.delete(cwd)
    }

    const agents: WorkflowRun['agents'] = {}
    for (const s of Object.values(def.stages)) {
      if (s.type === 'agent') agents[s.agent] = config.agents[s.agent]
    }
    const run: WorkflowRun = {
      id,
      taskId,
      workflow: { name: def.workflow, version: def.version },
      definition: def,
      agents,
      status: 'running',
      currentStage: startStage(def),
      loops: 0,
      pass: 0,
      loopBudget: def.limits.max_loops,
      costBudgetUsd: def.limits.max_cost_usd,
      cwd,
      branch,
      baseRef,
      handoff: { ticket, plan: null, planApproved: false, summaries: [], feedback: [] },
      stages: [],
      escalation: null,
      totals: { costUsd: 0, tokens: 0 },
      startedAt: this.ports.now(),
      endedAt: null,
    }
    this.runs[taskId] = [run, ...(this.runs[taskId] ?? [])].slice(0, MAX_RUNS_KEPT)
    this.log(run, `Workflow ${def.workflow} v${def.version} started on branch ${branch}.`)
    this.persist(run)
    this.kick(run)
    return run
  }

  decideGate(taskId: string, decision: 'approved' | 'rejected', comment: string): WorkflowRun {
    const run = this.latest(taskId)
    if (!run || run.status !== 'awaiting_gate') throw new WorkflowError(409, 'This task is not waiting for your approval.')
    const record = [...run.stages].reverse().find((r) => r.type === 'gate' && r.status === 'waiting')
    if (!record) throw new WorkflowError(409, 'No open gate found.')

    const text = comment.trim()
    const view = gateView(run, record.stage)
    this.finish(record, 'succeeded', {
      outcome: decision,
      summary: decision === 'approved' ? 'Approved' : 'Rejected',
      ...(text ? { comment: text } : {}),
    })
    if (decision === 'rejected' || text) {
      run.handoff.feedback.push({
        id: this.ports.newId(),
        source: 'human',
        stage: record.stage,
        text: text || 'Rejected without a comment.',
        consumed: false,
      })
    }
    if (decision === 'approved' && view === 'plan' && run.handoff.plan) {
      run.handoff.planApproved = true
      if (run.handoff.plan.steps.length) {
        this.ports.emitEffect({ target: 'tasks', kind: 'plan', taskId, steps: run.handoff.plan.steps })
      }
    }
    this.log(run, `Workflow ${record.stage}: you ${decision}${text ? ` - ${text}` : ''}.`)

    run.status = 'running'
    this.transition(run, record.stage, decision)
    if (run.status === 'running') this.kick(run)
    return run
  }

  /** Resumes an escalated, interrupted or cancelled run at `stage`. */
  retryFrom(taskId: string, stage: string): WorkflowRun {
    const run = this.latest(taskId)
    if (!run) throw new WorkflowError(404, 'No workflow run for this task.')
    if (isActiveRun(run) || run.status === 'completed') {
      throw new WorkflowError(409, `Can't resume a ${run.status.replace('_', ' ')} workflow.`)
    }
    if (!run.definition.stages[stage]) throw new WorkflowError(400, `Unknown stage: ${stage}`)
    this.checkFolderFree(run.cwd, taskId)

    // Resuming after hitting a limit grants another round of it.
    if (run.escalation?.reason === 'max_loops') run.loopBudget += run.definition.limits.max_loops
    if (run.escalation?.reason === 'budget') run.costBudgetUsd += run.definition.limits.max_cost_usd
    run.status = 'running'
    run.escalation = null
    run.endedAt = null
    run.currentStage = stage
    run.pass++
    this.log(run, `Workflow resumed from ${stage}.`)
    this.persist(run)
    this.kick(run)
    return run
  }

  cancel(taskId: string): WorkflowRun {
    const run = this.latest(taskId)
    if (!run || !isActiveRun(run)) throw new WorkflowError(409, 'No active workflow to cancel.')
    run.status = 'cancelled'
    run.endedAt = this.ports.now()
    for (const r of run.stages) {
      if (r.status === 'running' || r.status === 'waiting') this.finish(r, 'failed', { error: 'Cancelled by you.' })
    }
    this.aborts.get(taskId)?.abort()
    this.log(run, 'Workflow cancelled.')
    this.persist(run)
    return run
  }

  /** Task deleted: stop its workflow and drop its runs. */
  forget(taskId: string): void {
    this.aborts.get(taskId)?.abort()
    if (!this.runs[taskId]) return
    for (const run of this.runs[taskId]) if (isActiveRun(run)) run.status = 'cancelled'
    delete this.runs[taskId]
    this.ports.saveRuns(this.runs)
  }

  // ---- step loop ----

  private kick(run: WorkflowRun): void {
    const abort = new AbortController()
    this.aborts.set(run.taskId, abort)
    const loop = this.advance(run, abort.signal).catch((err: unknown) => {
      if (run.status === 'running') this.escalate(run, 'stage_error', `Engine error: ${message(err)}`)
    })
    this.loops.set(run.taskId, loop)
  }

  private async advance(run: WorkflowRun, signal: AbortSignal): Promise<void> {
    while (run.status === 'running' && run.currentStage && !signal.aborted) {
      const stage = run.currentStage
      const def = run.definition.stages[stage]
      if (def.type === 'gate') {
        this.addRecord(run, stage, 'gate', 'waiting')
        run.status = 'awaiting_gate'
        this.log(run, `Workflow is waiting for you at ${stage}.`)
        this.persist(run)
        return
      }
      const outcome =
        def.type === 'agent'
          ? await this.runAgentStage(run, stage, def, signal)
          : await this.runCommandStage(run, stage, def, signal)
      if (outcome === null || run.status !== 'running') return
      this.transition(run, stage, outcome)
    }
  }

  /** Moves to the stage the outcome leads to, counting loops. */
  private transition(run: WorkflowRun, from: string, outcome: string): void {
    const target = run.definition.stages[from].next[outcome]
    if (!target) {
      this.escalate(run, 'stage_error', `${from}: no transition for outcome "${outcome}".`)
      return
    }
    if (target === DONE) {
      run.status = 'completed'
      run.currentStage = null
      run.endedAt = this.ports.now()
      this.log(run, `Workflow finished. Branch ${run.branch} is ready for you to merge.`)
      this.persist(run)
      return
    }
    // Going back to a stage already entered in this pass is a loop. A gate
    // rejection is you steering, not agents bouncing, so it starts a new pass
    // without using up the loop budget.
    const revisit = run.stages.some((r) => r.stage === target && r.loopIndex === run.pass)
    if (revisit && run.definition.stages[from].type === 'gate') {
      run.pass++
    } else if (revisit) {
      if (run.loops >= run.loopBudget) {
        run.currentStage = target
        this.escalate(
          run,
          'max_loops',
          `Reached max_loops (${run.definition.limits.max_loops}): ${from} returned "${outcome}", which would go back to ${target} again.`,
        )
        return
      }
      run.loops++
      run.pass++
    }
    run.currentStage = target
    this.persist(run)
  }

  private async runAgentStage(
    run: WorkflowRun,
    stage: string,
    def: AgentStageDef,
    signal: AbortSignal,
  ): Promise<string | null> {
    const agent = run.agents[def.agent]
    const modeName = def.mode ?? 'default'
    const mode = agent.modes[modeName]
    if (run.totals.costUsd >= run.costBudgetUsd) {
      this.escalate(run, 'budget', `Spent $${run.totals.costUsd.toFixed(2)} of the $${run.costBudgetUsd.toFixed(2)} budget before ${stage}.`)
      return null
    }
    const feedback = run.handoff.feedback.filter((f) => !f.consumed)
    const record = this.addRecord(run, stage, 'agent', 'running')
    this.persist(run)

    const request = (prompt: string, resumeSessionId?: string): AgentStageRequest => ({
      taskId: run.taskId,
      stage,
      prompt,
      systemPrompt: buildStageSystemPrompt(run, stage, agent.rolePrompt),
      cwd: run.cwd,
      mode,
      ticket: run.handoff.ticket,
      maxBudgetUsd: Math.max(0.01, run.costBudgetUsd - run.totals.costUsd),
      resumeSessionId,
      signal,
      onStart: (runId) => {
        record.runId = runId
        this.persist(run)
      },
    })

    const fullPrompt = buildStagePrompt(run, stage, agent, modeName, feedback)
    let result = await this.callAgent(run, record, request(fullPrompt))
    if (run.status !== 'running') return null
    if (result.error) return this.failStage(run, record, 'stage_error', `${stage}: ${result.error}`)

    let parsed = parseVerdict(result.output, mode)
    if (!parsed.ok) {
      // One retry: ask the same session for valid output (or rerun if it has none).
      record.attempt = 2
      this.persist(run)
      result = await this.callAgent(
        run,
        record,
        result.sessionId
          ? request(buildRetryPrompt(parsed.errors, mode), result.sessionId)
          : request(`${fullPrompt}\n\n${buildRetryPrompt(parsed.errors, mode)}`),
      )
      if (run.status !== 'running') return null
      if (result.error) return this.failStage(run, record, 'stage_error', `${stage}: ${result.error}`)
      parsed = parseVerdict(result.output, mode)
    }
    if (!parsed.ok) {
      return this.failStage(
        run,
        record,
        'invalid_output',
        `${stage}: the ${agent.agent} agent returned invalid output twice (${parsed.errors.join('; ')}).`,
      )
    }

    const v = parsed.verdict
    const { outcome, normalized } = decideOutcome(agent, v)
    for (const f of feedback) f.consumed = true
    run.handoff.summaries.push({ stage, loopIndex: record.loopIndex, summary: v.summary })
    if (typeof v.plan === 'string') {
      run.handoff.plan = { text: v.plan, steps: Array.isArray(v.planSteps) ? v.planSteps : [] }
      run.handoff.planApproved = false
    }
    if (agent.outcomeFromIssues && outcome === agent.outcomeFromIssues.blocked) {
      run.handoff.feedback.push({
        id: this.ports.newId(),
        source: agent.agent,
        stage,
        text: v.summary,
        issues: v.issues,
        consumed: false,
      })
    }

    // Stages that can edit get their work committed on the task branch.
    if (mode.permissionMode === 'acceptEdits') {
      try {
        await this.ports.git.commitAll(run.cwd, `daily-focus: ${stage} (loop ${record.loopIndex})\n\n${v.summary}`)
        const diff = await this.ports.git.diff(run.cwd, run.baseRef)
        this.ports.writeDiff(run.taskId, record.id, diff.patch)
        record.hasDiff = true
        record.diffStat = diff.stat
      } catch (err) {
        return this.failStage(run, record, 'stage_error', `${stage}: could not commit the changes: ${message(err)}`)
      }
    }

    this.finish(record, 'succeeded', {
      outcome,
      summary: v.summary,
      issues: v.issues,
      ...(normalized ? { normalized: true } : {}),
    })
    this.log(run, `Workflow ${stage}: ${outcome} - ${v.summary}`, record.runId)
    this.ports.emitEffect({
      target: 'dailyStats',
      kind: 'stats',
      dayKey: dayKeyOf(new Date(this.ports.now())),
      runs: record.attempt,
      tokens: totalTokens(record.usage),
      costUsd: record.costUsd,
    })
    this.persist(run)
    return outcome
  }

  private async callAgent(run: WorkflowRun, record: StageRecord, req: AgentStageRequest): Promise<AgentStageResult> {
    let result: AgentStageResult
    try {
      result = await this.ports.runAgent(req)
    } catch (err) {
      return { runId: '', sessionId: null, output: null, error: message(err), usage: emptyUsage(), costUsd: 0 }
    }
    if (result.runId) record.runId = result.runId
    record.sessionId = result.sessionId
    const u = record.usage
    record.usage = {
      input: u.input + result.usage.input,
      output: u.output + result.usage.output,
      cacheRead: u.cacheRead + result.usage.cacheRead,
      cacheWrite: u.cacheWrite + result.usage.cacheWrite,
    }
    record.costUsd += result.costUsd
    run.totals.costUsd += result.costUsd
    run.totals.tokens += totalTokens(result.usage)
    return result
  }

  private async runCommandStage(
    run: WorkflowRun,
    stage: string,
    def: CommandStageDef,
    signal: AbortSignal,
  ): Promise<string | null> {
    const cmd = def.run.replace(CI_PLACEHOLDER, run.handoff.ticket.ciCommand.trim()).trim()
    const record = this.addRecord(run, stage, 'command', 'running')
    if (!cmd) return this.failStage(run, record, 'stage_error', `${stage}: no command to run. Set a test & lint command on the project.`)
    this.persist(run)

    let res: CommandResult
    try {
      res = await this.ports.runCommand(cmd, run.cwd, signal)
    } catch (err) {
      res = { exitCode: -1, output: message(err) }
    }
    if (run.status !== 'running') return null

    const outcome = res.exitCode === 0 ? 'pass' : 'fail'
    const tail = res.output.slice(-OUTPUT_TAIL)
    const summary = outcome === 'pass' ? `\`${cmd}\` passed.` : `\`${cmd}\` failed (exit ${res.exitCode}).`
    if (outcome === 'fail') {
      run.handoff.feedback.push({
        id: this.ports.newId(),
        source: 'ci',
        stage,
        text: `${summary} Last output:\n${tail.slice(-4000)}`,
        consumed: false,
      })
    }
    this.finish(record, 'succeeded', { outcome, summary, exitCode: res.exitCode, commandOutput: tail })
    this.log(run, `Workflow ${stage}: ${summary}`)
    this.persist(run)
    return outcome
  }

  // ---- helpers ----

  private addRecord(run: WorkflowRun, stage: string, type: StageType, status: StageRecord['status']): StageRecord {
    const record: StageRecord = {
      id: this.ports.newId(),
      stage,
      type,
      loopIndex: run.pass,
      attempt: 1,
      status,
      outcome: null,
      summary: '',
      issues: [],
      startedAt: this.ports.now(),
      endedAt: null,
      durationMs: 0,
      usage: emptyUsage(),
      costUsd: 0,
      runId: null,
      sessionId: null,
    }
    run.stages.push(record)
    return record
  }

  private finish(record: StageRecord, status: StageRecord['status'], patch: Partial<StageRecord> = {}): void {
    Object.assign(record, patch)
    record.status = status
    record.endedAt = this.ports.now()
    record.durationMs = record.endedAt - record.startedAt
  }

  private failStage(run: WorkflowRun, record: StageRecord, reason: EscalationReason, msg: string): null {
    this.finish(record, 'failed', { error: msg })
    this.escalate(run, reason, msg)
    return null
  }

  private escalate(run: WorkflowRun, reason: EscalationReason, msg: string): void {
    run.status = 'escalated'
    run.escalation = { reason, message: msg, loops: loopSummaries(run) }
    this.log(run, `Workflow needs you: ${msg}`)
    this.persist(run)
  }

  private checkFolderFree(cwd: string, taskId: string): void {
    const busy =
      this.starting.has(cwd) ||
      Object.entries(this.runs).some(([id, runs]) => id !== taskId && isActiveRun(runs[0]) && runs[0].cwd === cwd)
    if (busy) throw new WorkflowError(409, `Another task's workflow is using ${cwd}. Finish or cancel it first.`)
  }

  private log(run: WorkflowRun, text: string, runId?: string | null): void {
    this.ports.emitEffect({
      target: 'tasks',
      kind: 'log',
      taskId: run.taskId,
      entry: { at: this.ports.now(), kind: 'claude', text, ...(runId ? { runId } : {}) },
    })
  }

  private persist(run: WorkflowRun): void {
    // A forgotten task's run may still finish a step; don't resurrect it.
    if (!this.runs[run.taskId]?.includes(run)) return
    this.ports.saveRuns(this.runs)
    this.ports.emit(run.taskId, this.runs[run.taskId])
  }
}

/** What happened in each loop, for escalation summaries. */
export function loopSummaries(run: WorkflowRun): LoopSummary[] {
  const byLoop = new Map<number, LoopSummary>()
  for (const r of run.stages) {
    if (!byLoop.has(r.loopIndex)) byLoop.set(r.loopIndex, { loopIndex: r.loopIndex, stages: [] })
    byLoop.get(r.loopIndex)!.stages.push({
      stage: r.stage,
      outcome: r.outcome,
      summary: r.error ?? r.comment ?? r.summary,
      issues: r.issues,
    })
  }
  return [...byLoop.values()].sort((a, b) => a.loopIndex - b.loopIndex)
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'task'
  )
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
