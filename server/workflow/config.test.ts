import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentDef, WorkflowDef } from '../../src/lib/workflowTypes'
import { loadWorkflowConfig, validateAgent, validateWorkflow } from './config'

const schema = (outcomes: string[]) => ({
  type: 'object' as const,
  properties: { verdict: { type: 'string' as const, enum: outcomes }, summary: { type: 'string' as const } },
  required: ['verdict', 'summary'],
})

const agents: Record<string, AgentDef> = {
  coder: {
    agent: 'coder',
    prompt: 'coder.md',
    modes: {
      plan: { permissionMode: 'plan', instructions: '', outputSchema: schema(['done']) },
      implement: { permissionMode: 'acceptEdits', instructions: '', outputSchema: schema(['done']) },
    },
  },
  reviewer: {
    agent: 'reviewer',
    prompt: 'reviewer.md',
    modes: { default: { permissionMode: 'default', instructions: '', outputSchema: schema(['approved', 'changes_requested']) } },
  },
}

function workflow(stages: WorkflowDef['stages'], extra: Partial<WorkflowDef> = {}): WorkflowDef {
  return {
    workflow: 'test',
    version: 1,
    stages,
    limits: { max_loops: 3, max_cost_usd: 5, timeout_minutes: 60 },
    ...extra,
  }
}

const valid = () =>
  workflow({
    implement: { type: 'agent', agent: 'coder', mode: 'implement', next: { done: 'ci' } },
    ci: { type: 'command', run: 'npm test', next: { pass: 'review', fail: 'implement' } },
    review: { type: 'agent', agent: 'reviewer', next: { approved: 'gate', changes_requested: 'implement' } },
    gate: { type: 'gate', next: { approved: 'done', rejected: 'implement' } },
  })

describe('validateWorkflow', () => {
  it('accepts a valid workflow', () => {
    expect(validateWorkflow(valid(), agents)).toEqual([])
  })

  it('rejects unknown transition targets', () => {
    const def = valid()
    def.stages.ci.next.fail = 'implment'
    expect(validateWorkflow(def, agents)).toContain('stages.ci.next.fail: unknown stage "implment"')
  })

  it('rejects unknown agents and modes', () => {
    const def = valid()
    def.stages.implement = { type: 'agent', agent: 'qa', next: { done: 'ci' } }
    expect(validateWorkflow(def, agents)).toContain('stages.implement.agent: unknown agent "qa"')
    def.stages.implement = { type: 'agent', agent: 'coder', mode: 'fly', next: { done: 'ci' } }
    expect(validateWorkflow(def, agents)).toContain('stages.implement.mode: agent "coder" has no mode "fly"')
  })

  it('rejects missing and unknown transitions', () => {
    const def = valid()
    def.stages.ci.next = { pass: 'review' }
    def.stages.gate.next = { approved: 'done', rejected: 'implement', maybe: 'done' }
    const errors = validateWorkflow(def, agents)
    expect(errors).toContain('stages.ci.next: missing transition for "fail"')
    expect(errors).toContain('stages.gate.next.maybe: not an outcome of this stage (expected approved, rejected)')
  })

  it('rejects unreachable stages', () => {
    const def = valid()
    def.stages.orphan = { type: 'command', run: 'true', next: { pass: 'done', fail: 'done' } }
    expect(validateWorkflow(def, agents)).toContain('stages.orphan: unreachable from "implement"')
  })

  it('rejects loops with no exit', () => {
    const def = workflow({
      implement: { type: 'agent', agent: 'coder', mode: 'implement', next: { done: 'ci' } },
      ci: { type: 'command', run: 'npm test', next: { pass: 'implement', fail: 'implement' } },
    })
    const errors = validateWorkflow(def, agents)
    expect(errors).toContain('stages.implement: can never reach "done" (loop with no exit)')
    expect(errors).toContain('stages.ci: can never reach "done" (loop with no exit)')
  })

  it('rejects bad limits, version, start and reserved names', () => {
    const def = valid() as unknown as Record<string, unknown>
    def.version = 0
    def.start = 'nope'
    def.limits = { max_loops: -1, max_cost_usd: 0, timeout_minutes: 'x' }
    ;(def.stages as Record<string, unknown>).done = { type: 'gate', next: {} }
    const errors = validateWorkflow(def, agents)
    expect(errors).toEqual(
      expect.arrayContaining([
        'version: must be a positive integer',
        'start: unknown stage "nope"',
        'limits.max_loops: must be a non-negative integer',
        'limits.max_cost_usd: must be a positive number',
        'limits.timeout_minutes: must be a positive number',
        'stages.done: "done" is reserved for the end of the workflow',
      ]),
    )
  })

  it('rejects unknown stage types and empty commands', () => {
    const def = valid() as unknown as { stages: Record<string, unknown> }
    def.stages.ci = { type: 'command', run: ' ', next: { pass: 'review', fail: 'implement' } }
    def.stages.gate = { type: 'vote', next: {} }
    const errors = validateWorkflow(def, agents)
    expect(errors).toContain('stages.ci.run: required command')
    expect(errors).toContain('stages.gate.type: must be one of agent, command, gate')
  })
})

describe('validateAgent', () => {
  it('accepts the test agents', () => {
    for (const a of Object.values(agents)) expect(validateAgent(a)).toEqual([])
  })

  it('requires a verdict enum and summary in the output schema', () => {
    const bad = {
      agent: 'x',
      prompt: 'x.md',
      modes: {
        default: {
          permissionMode: 'yolo',
          instructions: '',
          outputSchema: { type: 'object', properties: { summary: { type: 'number' } }, required: [] },
        },
      },
    }
    expect(validateAgent(bad)).toEqual(
      expect.arrayContaining([
        'modes.default.permissionMode: must be one of plan, default, acceptEdits',
        'modes.default.outputSchema.properties.verdict: must be a string enum of outcomes',
        'modes.default.outputSchema.properties.summary: must be a string',
        'modes.default.outputSchema.required: must include "verdict"',
      ]),
    )
  })

  it('checks outcomeFromIssues names real verdicts', () => {
    const a = { ...agents.reviewer, outcomeFromIssues: { blocking: ['major'], blocked: 'nope', clear: 'approved' } }
    expect(validateAgent(a)).toContain('outcomeFromIssues: "nope" is not a verdict of mode default')
  })
})

describe('shipped workflows', () => {
  it('all validate', () => {
    const config = loadWorkflowConfig(path.resolve(__dirname, '../../workflows'))
    expect(config.agentErrors).toEqual({})
    expect(config.summaries.map((s) => [s.id, s.errors])).toEqual([
      ['bugfix', []],
      ['standard-dev', []],
    ])
    expect(config.agents.coder.rolePrompt).toContain('coder')
  })
})
