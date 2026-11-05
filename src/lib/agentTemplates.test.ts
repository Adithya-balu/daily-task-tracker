import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWorkflowConfig } from '../../server/workflow/config'
import {
  OUTPUT_TEMPLATES,
  STARTER_AGENTS,
  TOOL_PRESETS,
  applyPreset,
  buildOutputSchema,
  describeOutput,
  isBaselineRule,
  modeWarnings,
} from './agentTemplates'
import { validateAgent, validateWorkflow } from './workflowValidate'
import type { WorkflowDef } from './workflowTypes'

const shipped = loadWorkflowConfig(path.resolve(__dirname, '../../workflows'))

describe('output templates', () => {
  it('reads the shipped agent schemas back as their templates', () => {
    expect(describeOutput(shipped.agents.coder.modes.plan.outputSchema)?.template).toBe('plan')
    expect(describeOutput(shipped.agents.coder.modes.implement.outputSchema)?.template).toBe('implement')
    expect(describeOutput(shipped.agents.reviewer.modes.default.outputSchema)?.template).toBe('review')
  })

  it('round-trips every template and custom verdict lists', () => {
    for (const t of Object.values(OUTPUT_TEMPLATES)) {
      expect(describeOutput(buildOutputSchema(t.verdicts, t.fields))).toMatchObject({ verdicts: t.verdicts, fields: t.fields })
    }
    expect(describeOutput(buildOutputSchema(['ok', 'retry'], ['issues']))).toEqual({
      template: 'custom',
      verdicts: ['ok', 'retry'],
      fields: ['issues'],
    })
  })

  it('returns null for hand-written schemas the form cannot show', () => {
    const schema = buildOutputSchema(['done'], [])
    schema.properties!.extra = { type: 'number' }
    expect(describeOutput(schema)).toBeNull()
  })
})

describe('starter agents', () => {
  it('are valid and can run in a workflow', () => {
    for (const [key, starter] of Object.entries(STARTER_AGENTS)) {
      const { def } = starter.build(`my-${key}`)
      expect(validateAgent(def)).toEqual([])
      const outcomes = def.modes.default.outputSchema.properties!.verdict.enum!.map(String)
      const wf: WorkflowDef = {
        workflow: 'w',
        version: 1,
        stages: { only: { type: 'agent', agent: def.agent, mode: 'default', next: Object.fromEntries(outcomes.map((o) => [o, 'done'])) } },
        limits: { max_loops: 1, max_cost_usd: 1, timeout_minutes: 1 },
      }
      expect(validateWorkflow(wf, { [def.agent]: def })).toEqual([])
    }
  })
})

describe('presets and warnings', () => {
  it('applies a preset without touching instructions or output', () => {
    const before = shipped.agents.reviewer.modes.default
    const after = applyPreset(before, TOOL_PRESETS.editCode)
    expect(after).toMatchObject({ permissionMode: 'acceptEdits', instructions: before.instructions, outputSchema: before.outputSchema })
  })

  it('warns when a judging mode can edit, or Bash is unrestricted', () => {
    const review = shipped.agents.reviewer.modes.default
    expect(modeWarnings(review)).toEqual([])
    expect(modeWarnings(applyPreset(review, TOOL_PRESETS.editCode))).toHaveLength(2)
    expect(modeWarnings(applyPreset(review, TOOL_PRESETS.runChecks))).toEqual([expect.stringMatching(/^Bash is allowed/)])
  })

  it('knows the locked baseline rules', () => {
    expect(isBaselineRule('Bash(git push:*)')).toBe(true)
    expect(isBaselineRule('Bash(git commit:*)')).toBe(false)
  })
})
