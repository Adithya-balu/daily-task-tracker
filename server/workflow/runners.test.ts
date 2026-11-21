import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASELINE_DISALLOWED_TOOLS } from '../../src/lib/workflowTypes'
import { loadWorkflowConfig } from './config'
import type { AgentStageRequest } from './engine'
import { headlessRequest } from './runners'

const { agents } = loadWorkflowConfig(path.resolve(__dirname, '../../workflows'))

const request = (over: Partial<AgentStageRequest>): AgentStageRequest => ({
  taskId: 't1',
  stage: 'review',
  prompt: 'p',
  systemPrompt: 's',
  cwd: '/tmp/x',
  mode: agents.reviewer.modes.default,
  ticket: {
    title: 'T',
    notes: '',
    references: [],
    plan: [],
    projectRules: '',
    ciCommand: 'npm test',
    workingDir: '/tmp/x',
    addDirs: [],
  },
  maxBudgetUsd: 1,
  signal: new AbortController().signal,
  onStart: () => {},
  ...over,
})

describe('headlessRequest', () => {
  it('always adds the baseline denies, even when the agent allows those tools', () => {
    const mode = { ...agents.coder.modes.implement, allowedTools: ['Bash'], disallowedTools: ['Bash(rm:*)'] }
    const req = headlessRequest(request({ mode }))
    for (const rule of BASELINE_DISALLOWED_TOOLS) expect(req.disallowedTools).toContain(rule)
    expect(req.disallowedTools).toContain('Bash(rm:*)')
    expect(new Set(req.disallowedTools).size).toBe(req.disallowedTools.length)
  })

  it('passes the stage model and effort through', () => {
    const req = headlessRequest(request({ model: 'haiku', effort: 'low' }))
    expect([req.model, req.effort]).toEqual(['haiku', 'low'])
  })
})
