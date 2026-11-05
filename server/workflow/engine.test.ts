import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyUsage, type DistributiveOmit, type Effect } from '../../src/lib/agentTypes'
import type { Ticket, WorkflowDef, WorkflowRun, WorkflowRunMap } from '../../src/lib/workflowTypes'
import { loadWorkflowConfig, validateWorkflow, type WorkflowConfig } from './config'
import {
  WorkflowEngine,
  WorkflowError,
  type AgentStageRequest,
  type AgentStageResult,
  type CommandResult,
  type EnginePorts,
} from './engine'

const shipped = loadWorkflowConfig(path.resolve(__dirname, '../../workflows'))

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  title: 'Add login form',
  notes: '',
  references: [],
  plan: [],
  projectRules: '',
  ciCommand: 'npm test',
  workingDir: '/repo',
  addDirs: [],
  ...over,
})

type AgentReply = Partial<AgentStageResult> & { output?: unknown }

const plan = { verdict: 'done', summary: 'Planned it.', plan: '1. Do it', planSteps: ['Do it'] }
const implemented = { verdict: 'done', summary: 'Implemented it.', filesChanged: ['a.ts'] }
const approved = { verdict: 'approved', summary: 'Looks good.', issues: [] }
const changes = (severity = 'major') => ({
  verdict: 'changes_requested',
  summary: 'Needs work.',
  issues: [{ severity, file: 'a.ts', line: 3, description: 'Missing null check' }],
})

/** Fake ports: scripted agent replies and command exit codes per stage. */
function makePorts(config: WorkflowConfig = shipped) {
  const replies: Record<string, AgentReply[]> = {}
  const exits: Record<string, number[]> = {}
  const calls: AgentStageRequest[] = []
  const commands: string[] = []
  const commits: string[] = []
  const effects: DistributiveEffect[] = []
  let saved: WorkflowRunMap = {}
  let clock = 1000
  let ids = 0
  let gitClean = true

  const ports: EnginePorts = {
    loadConfig: () => config,
    runAgent: async (req) => {
      calls.push(req)
      const runId = `run-${calls.length}`
      req.onStart(runId)
      const reply = replies[req.stage]?.shift() ?? { output: defaultOutput(req.stage) }
      clock += 60_000
      return {
        runId,
        sessionId: `session-${calls.length}`,
        output: null,
        error: null,
        usage: { ...emptyUsage(), input: 100, output: 50 },
        costUsd: 0.1,
        ...reply,
      }
    },
    runCommand: async (cmd): Promise<CommandResult> => {
      commands.push(cmd)
      const code = exits[cmd]?.shift() ?? 0
      return { exitCode: code, output: code ? 'FAIL a.test.ts' : 'ok' }
    },
    resolveDir: (dir) => {
      if (!dir.startsWith('/')) throw new Error('Working folder must be an absolute path')
      return dir
    },
    git: {
      prepareBranch: async () => {
        if (!gitClean) throw new Error('Working tree has uncommitted changes.')
        return { baseRef: 'abc123' }
      },
      commitAll: async (_cwd, msg) => {
        commits.push(msg)
        return true
      },
      diff: async () => ({ stat: ' a.ts | 3 +++', patch: '+code' }),
    },
    writeDiff: () => {},
    loadRuns: () => structuredClone(saved),
    saveRuns: (runs) => {
      saved = structuredClone(runs)
    },
    emit: () => {},
    emitEffect: (e) => effects.push(e as DistributiveEffect),
    now: () => clock++,
    newId: () => `id-${++ids}`,
  }
  return {
    ports,
    calls,
    commands,
    commits,
    effects,
    saved: () => saved,
    setClean: (v: boolean) => (gitClean = v),
    reply: (stage: string, ...r: AgentReply[]) => (replies[stage] = [...(replies[stage] ?? []), ...r]),
    exit: (cmd: string, ...codes: number[]) => (exits[cmd] = [...(exits[cmd] ?? []), ...codes]),
  }
}
type DistributiveEffect = DistributiveOmit<Effect, 'id'>

function defaultOutput(stage: string): unknown {
  if (stage === 'analysis') return plan
  if (stage === 'review') return approved
  return implemented
}

function configWith(def: WorkflowDef): WorkflowConfig {
  return { ...shipped, workflows: { [def.workflow]: { def, errors: validateWorkflow(def, shipped.agents) } } }
}

const stagesOf = (run: WorkflowRun) => run.stages.map((s) => `${s.stage}:${s.outcome ?? s.status}`)

describe('WorkflowEngine', () => {
  let f: ReturnType<typeof makePorts>
  let engine: WorkflowEngine

  beforeEach(() => {
    f = makePorts()
    engine = new WorkflowEngine(f.ports)
  })

  async function startAndSettle(workflow = 'standard-dev', t = ticket()) {
    const run = await engine.start('t1', workflow, t)
    await engine.settled('t1')
    return run
  }

  async function approve(comment = '') {
    engine.decideGate('t1', 'approved', comment)
    await engine.settled('t1')
  }

  it('runs plan, stops at the plan gate, then implement → ci → review → merge gate → done', async () => {
    const run = await startAndSettle()
    expect(run.status).toBe('awaiting_gate')
    expect(run.currentStage).toBe('plan_approval')
    expect(run.handoff.plan).toEqual({ text: '1. Do it', steps: ['Do it'] })
    expect(run.workflow).toEqual({ name: 'standard-dev', version: 1 })
    expect(run.branch).toBe('daily-focus/add-login-form-id-1')
    expect(run.baseRef).toBe('abc123')

    await approve()
    expect(run.handoff.planApproved).toBe(true)
    expect(f.effects).toContainEqual({ target: 'tasks', kind: 'plan', taskId: 't1', steps: ['Do it'] })
    expect(run.status).toBe('awaiting_gate')
    expect(run.currentStage).toBe('merge_approval')
    expect(f.commands).toEqual(['npm test'])
    expect(f.commits).toHaveLength(1)

    await approve()
    expect(run.status).toBe('completed')
    expect(run.loops).toBe(0)
    expect(stagesOf(run)).toEqual([
      'analysis:done',
      'plan_approval:approved',
      'implement:done',
      'ci:pass',
      'review:approved',
      'merge_approval:approved',
    ])
  })

  it('records time, usage, cost, run log and session per agent stage', async () => {
    const run = await startAndSettle()
    const analysis = run.stages[0]
    expect(analysis.runId).toBe('run-1')
    expect(analysis.sessionId).toBe('session-1')
    expect(analysis.costUsd).toBeCloseTo(0.1)
    expect(analysis.usage.input).toBe(100)
    expect(analysis.durationMs).toBeGreaterThanOrEqual(60_000)
    expect(run.totals.costUsd).toBeCloseTo(0.1)
    expect(run.totals.tokens).toBe(150)
    // Saved after every step.
    expect(f.saved().t1[0].stages).toHaveLength(2)
  })

  it('passes the approved plan and handoff to later stages, never a shared session', async () => {
    await startAndSettle()
    await approve('Keep it small')
    const implement = f.calls.find((c) => c.stage === 'implement')!
    expect(implement.resumeSessionId).toBeUndefined()
    expect(implement.prompt).toContain('## Approved plan\n1. Do it')
    expect(implement.prompt).toContain('Keep it small')
    expect(implement.prompt).toContain('git diff abc123..HEAD')
    expect(implement.mode.permissionMode).toBe('acceptEdits')
    const review = f.calls.find((c) => c.stage === 'review')!
    expect(review.prompt).toContain('a.ts | 3 +++')
    expect(review.prompt).toContain('- implement: Implemented it.')
    expect(review.mode.disallowedTools).toContain('Edit')
  })

  it('loops back to implement on CI failure with the output as feedback', async () => {
    f.exit('npm test', 1, 0)
    const run = await startAndSettle()
    await approve()
    expect(stagesOf(run).slice(2)).toEqual(['implement:done', 'ci:fail', 'implement:done', 'ci:pass', 'review:approved', 'merge_approval:waiting'])
    expect(run.loops).toBe(1)
    const second = f.calls.filter((c) => c.stage === 'implement')[1]
    expect(second.prompt).toContain('From CI (after ci)')
    expect(second.prompt).toContain('FAIL a.test.ts')
    // Feedback is consumed once handed to an agent.
    expect(run.handoff.feedback.every((x) => x.consumed)).toBe(true)
    expect(run.stages[3].loopIndex).toBe(0)
    expect(run.stages[4].loopIndex).toBe(1)
  })

  it('loops back to implement on changes_requested with the issues as feedback', async () => {
    f.reply('review', { output: changes('blocker') }, { output: approved })
    const run = await startAndSettle()
    await approve()
    expect(stagesOf(run).slice(2)).toEqual([
      'implement:done',
      'ci:pass',
      'review:changes_requested',
      'implement:done',
      'ci:pass',
      'review:approved',
      'merge_approval:waiting',
    ])
    const second = f.calls.filter((c) => c.stage === 'implement')[1]
    expect(second.prompt).toContain('From reviewer (after review)')
    expect(second.prompt).toContain('[blocker] a.ts:3: Missing null check')
  })

  it('only blocker and major issues request changes; the verdict is normalized', async () => {
    f.reply('review', { output: changes('minor') })
    const run = await startAndSettle()
    await approve()
    const review = run.stages.find((s) => s.stage === 'review')!
    expect(review.outcome).toBe('approved')
    expect(review.normalized).toBe(true)
    expect(review.issues).toHaveLength(1)
    expect(run.currentStage).toBe('merge_approval')

    // And the other way round: "approved" with a major issue is sent back.
    const g = makePorts()
    g.reply('review', { output: { ...changes('major'), verdict: 'approved' } }, { output: approved })
    const e2 = new WorkflowEngine(g.ports)
    const r2 = await e2.start('t1', 'standard-dev', ticket())
    await e2.settled('t1')
    e2.decideGate('t1', 'approved', '')
    await e2.settled('t1')
    expect(r2.stages.find((s) => s.stage === 'review')!.outcome).toBe('changes_requested')
  })

  it('escalates with a per-loop summary when max_loops is exceeded', async () => {
    f.exit('npm test', 1, 1, 1, 1, 1)
    const run = await startAndSettle()
    await approve()
    expect(run.status).toBe('escalated')
    expect(run.loops).toBe(3)
    expect(run.escalation?.reason).toBe('max_loops')
    expect(run.escalation?.message).toContain('max_loops (3)')
    expect(run.currentStage).toBe('implement')
    expect(f.calls.filter((c) => c.stage === 'implement')).toHaveLength(4)
    const loops = run.escalation!.loops
    expect(loops.map((l) => l.loopIndex)).toEqual([0, 1, 2, 3])
    expect(loops[1].stages.map((s) => `${s.stage}:${s.outcome}`)).toEqual(['implement:done', 'ci:fail'])
    expect(f.effects.some((e) => e.kind === 'log' && e.entry.text.startsWith('Workflow needs you'))).toBe(true)
  })

  it('resuming after max_loops grants another round of loops', async () => {
    f.exit('npm test', 1, 1, 1, 1, 0)
    const run = await startAndSettle()
    await approve()
    expect(run.status).toBe('escalated')
    engine.retryFrom('t1', 'implement')
    await engine.settled('t1')
    expect(run.loopBudget).toBe(6)
    expect(run.escalation).toBeNull()
    expect(run.currentStage).toBe('merge_approval')
  })

  it('retries once on invalid output by resuming the same session', async () => {
    f.reply('analysis', { output: { verdict: 'done' } }, { output: plan })
    const run = await startAndSettle()
    expect(run.status).toBe('awaiting_gate')
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1].resumeSessionId).toBe('session-1')
    expect(f.calls[1].prompt).toContain('output.summary: is required')
    expect(run.stages[0].attempt).toBe(2)
    expect(run.stages[0].costUsd).toBeCloseTo(0.2)
  })

  it('fails the stage and escalates when output is invalid twice', async () => {
    f.reply('analysis', { output: null }, { output: { verdict: 'maybe', summary: 'x' } })
    const run = await startAndSettle()
    expect(run.status).toBe('escalated')
    expect(run.escalation?.reason).toBe('invalid_output')
    expect(run.stages[0].status).toBe('failed')
    expect(run.stages[0].error).toContain('output.verdict: must be one of "done"')
    expect(f.calls).toHaveLength(2)
  })

  it('escalates when a session fails', async () => {
    f.reply('analysis', { error: 'Run ended: error_max_turns' })
    const run = await startAndSettle()
    expect(run.status).toBe('escalated')
    expect(run.escalation?.reason).toBe('stage_error')
    expect(f.calls).toHaveLength(1)
  })

  it('a plan rejection sends the comment back to analysis without using a loop', async () => {
    const run = await startAndSettle()
    engine.decideGate('t1', 'rejected', 'Use the existing auth module')
    await engine.settled('t1')
    expect(run.loops).toBe(0)
    expect(run.pass).toBe(1)
    expect(run.currentStage).toBe('plan_approval')
    expect(run.handoff.planApproved).toBe(false)
    const second = f.calls.filter((c) => c.stage === 'analysis')[1]
    expect(second.prompt).toContain('From the user (after plan_approval)')
    expect(second.prompt).toContain('Use the existing auth module')
    expect(run.stages[1]).toMatchObject({ outcome: 'rejected', comment: 'Use the existing auth module' })
  })

  it('gate rejections never escalate for max_loops, but agent loops still count', async () => {
    const run = await startAndSettle()
    for (let i = 0; i < 5; i++) {
      engine.decideGate('t1', 'rejected', `Not yet (${i})`)
      await engine.settled('t1')
    }
    expect(run.status).toBe('awaiting_gate')
    expect(run.currentStage).toBe('plan_approval')
    expect(run.loops).toBe(0)

    f.exit('npm test', 1, 0)
    await approve()
    expect(run.currentStage).toBe('merge_approval')
    expect(run.loops).toBe(1)
    engine.decideGate('t1', 'rejected', 'Rename the helper')
    await engine.settled('t1')
    expect(run.status).toBe('awaiting_gate')
    expect(run.currentStage).toBe('merge_approval')
    expect(run.loops).toBe(1)
  })

  it('rejects gate decisions when not waiting at a gate', async () => {
    f.reply('analysis', { error: 'boom' })
    await startAndSettle()
    expect(() => engine.decideGate('t1', 'approved', '')).toThrow(WorkflowError)
  })

  it('blocks manual runs while active and frees them after cancel', async () => {
    await startAndSettle()
    expect(engine.guard('t1')).toMatch(/workflow is driving/)
    const run = engine.cancel('t1')
    expect(run.status).toBe('cancelled')
    expect(run.stages[1]).toMatchObject({ status: 'failed', error: 'Cancelled by you.' })
    expect(engine.guard('t1')).toBeNull()
  })

  it('cancel stops a running stage and ignores its result', async () => {
    let release!: () => void
    f.ports.runAgent = (req) =>
      new Promise((resolve) => {
        req.onStart('run-x')
        release = () => resolve({ runId: 'run-x', sessionId: 's', output: plan, error: 'Stopped by you.', usage: emptyUsage(), costUsd: 0 })
      })
    const run = await engine.start('t1', 'standard-dev', ticket())
    engine.cancel('t1')
    release()
    await engine.settled('t1')
    expect(run.status).toBe('cancelled')
    expect(run.stages).toHaveLength(1)
  })

  it('locks a working folder to one active workflow', async () => {
    await startAndSettle()
    await expect(engine.start('t2', 'standard-dev', ticket())).rejects.toThrow(/Another task's workflow/)
    await expect(engine.start('t1', 'standard-dev', ticket())).rejects.toThrow(/already running/)
    await expect(engine.start('t3', 'standard-dev', ticket({ workingDir: '/other' }))).resolves.toBeTruthy()
  })

  it('refuses to start without a CI command, on a dirty tree, or with an invalid workflow', async () => {
    await expect(engine.start('t1', 'standard-dev', ticket({ ciCommand: ' ' }))).rejects.toThrow(/test & lint command/)
    f.setClean(false)
    await expect(engine.start('t1', 'standard-dev', ticket())).rejects.toThrow(/uncommitted/)
    await expect(engine.start('t1', 'nope', ticket())).rejects.toThrow(/Unknown workflow/)

    const def = structuredClone(shipped.workflows['standard-dev'].def)
    def.stages.ci.next.fail = 'nowhere'
    const e = new WorkflowEngine(makePorts(configWith(def)).ports)
    await expect(e.start('t1', 'standard-dev', ticket())).rejects.toThrow(/invalid: stages.ci.next.fail/)
  })

  it('escalates when the cost budget is spent and resuming grants more', async () => {
    const def = structuredClone(shipped.workflows['standard-dev'].def)
    def.limits.max_cost_usd = 0.15
    const g = makePorts(configWith(def))
    const e = new WorkflowEngine(g.ports)
    const run = await e.start('t1', 'standard-dev', ticket())
    await e.settled('t1')
    e.decideGate('t1', 'approved', '')
    await e.settled('t1')
    // Analysis cost 0.10; implement runs (0.20 total) then review is over budget.
    expect(run.status).toBe('escalated')
    expect(run.escalation?.reason).toBe('budget')
    expect(run.currentStage).toBe('review')
    e.retryFrom('t1', 'review')
    await e.settled('t1')
    expect(run.costBudgetUsd).toBeCloseTo(0.3)
    expect(run.currentStage).toBe('merge_approval')
  })

  it('marks runs that were mid-stage at restart as interrupted and resumable', async () => {
    let release!: () => void
    f.ports.runAgent = () => new Promise(() => (release = () => {}))
    await engine.start('t1', 'standard-dev', ticket())
    release?.()
    // A new engine over the same saved state = a server restart.
    const restarted = new WorkflowEngine(f.ports)
    const run = restarted.latest('t1')!
    expect(run.status).toBe('interrupted')
    expect(run.stages[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('restarted') })
    expect(restarted.guard('t1')).toBeNull()

    f.ports.runAgent = makePorts().ports.runAgent
    restarted.retryFrom('t1', 'analysis')
    await restarted.settled('t1')
    expect(restarted.latest('t1')!.status).toBe('awaiting_gate')
  })

  it('forget drops the runs and ignores late results', async () => {
    await startAndSettle()
    engine.forget('t1')
    expect(engine.latest('t1')).toBeUndefined()
    expect(f.saved().t1).toBeUndefined()
  })

  it('runs a workflow without a plan stage (bugfix)', async () => {
    const run = await startAndSettle('bugfix')
    expect(stagesOf(run)).toEqual(['implement:done', 'ci:pass', 'review:approved', 'merge_approval:waiting'])
    expect(f.calls[0].prompt).not.toContain('Approved plan')
  })
})
