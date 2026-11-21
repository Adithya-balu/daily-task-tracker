import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentDef, WorkflowDef } from '../../src/lib/workflowTypes'
import { AiConfigStore } from './aiStore'
import { WorkflowError } from './engine'

const builtin = path.resolve(__dirname, '../../workflows')
let user: string
let store: AiConfigStore

beforeEach(() => {
  user = fs.mkdtempSync(path.join(os.tmpdir(), 'df-ai-'))
  store = new AiConfigStore({ builtin, user })
})
afterEach(() => fs.rmSync(user, { recursive: true, force: true }))

const workflow = (id: string) => store.load().ai.workflows.find((w) => w.id === id)!
const agent = (id: string) => store.load().ai.agents.find((a) => a.id === id)!
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function fails(fn: () => unknown, status: number, text: RegExp | string) {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(WorkflowError)
    expect((err as WorkflowError).status).toBe(status)
    expect((err as Error).message).toMatch(text)
    return
  }
  throw new Error('expected a WorkflowError')
}

describe('merged config', () => {
  it('lists the built-ins with their sources and which workflows use each agent', () => {
    const { ai } = store.load()
    expect(ai.workflows.map((w) => [w.id, w.source, w.errors])).toEqual([
      ['bugfix', 'builtin', []],
      ['standard-dev', 'builtin', []],
    ])
    expect(ai.agents.map((a) => [a.id, a.source, a.usedBy])).toEqual([
      ['coder', 'builtin', ['bugfix', 'standard-dev']],
      ['reviewer', 'builtin', ['bugfix', 'standard-dev']],
    ])
    expect(agent('coder').rolePrompt).toContain('coder')
  })

  it('reports a malformed user file instead of failing to load', () => {
    fs.mkdirSync(path.join(user, 'workflows'))
    fs.writeFileSync(path.join(user, 'workflows', 'broken.json'), '{ nope')
    const w = workflow('broken')
    expect(w.source).toBe('custom')
    expect(w.def).toBeNull()
    expect(w.errors[0]).toMatch(/^broken.json: /)
    expect(store.load().summaries.find((s) => s.id === 'broken')!.valid).toBe(false)
  })
})

describe('saving workflows', () => {
  it('overrides a built-in, bumps the version, and resets back to the default', () => {
    const def = clone(workflow('bugfix').def!)
    def.limits.max_loops = 5
    const saved = store.saveWorkflow('bugfix', def, 1)
    expect(saved).toMatchObject({ source: 'modified', def: { version: 2, limits: { max_loops: 5 } } })
    expect(store.load().workflows.bugfix.def.limits.max_loops).toBe(5)

    store.remove('workflow', 'bugfix')
    expect(workflow('bugfix')).toMatchObject({ source: 'builtin', def: { version: 1 } })

    // Editing again after a reset never reuses a version a run may have recorded.
    expect(store.saveWorkflow('bugfix', def, 1).def!.version).toBe(3)
  })

  it('creates a custom workflow with its id as the name, and deletes it', () => {
    const def = { ...clone(workflow('bugfix').def!), workflow: 'ignored', version: 99 }
    const saved = store.saveWorkflow('quick-fix', def, null)
    expect(saved).toMatchObject({ id: 'quick-fix', source: 'custom', def: { workflow: 'quick-fix', version: 1 } })
    expect(fs.existsSync(path.join(user, 'workflows', 'quick-fix.json'))).toBe(true)
    store.remove('workflow', 'quick-fix')
    expect(workflow('quick-fix')).toBeUndefined()
  })

  it('refuses stale or conflicting saves', () => {
    const def = clone(workflow('bugfix').def!)
    store.saveWorkflow('bugfix', def, 1)
    fails(() => store.saveWorkflow('bugfix', def, 1), 409, /changed elsewhere \(now version 2\)/)
    fails(() => store.saveWorkflow('bugfix', def, null), 409, /already exists/)
    fails(() => store.saveWorkflow('missing', def, 1), 404, /Unknown workflow/)
  })

  it('refuses invalid workflows and writes nothing', () => {
    const def = clone(workflow('bugfix').def!) as WorkflowDef
    def.stages.ci.next.fail = 'implment'
    fails(() => store.saveWorkflow('bugfix', def, 1), 400, /stages.ci.next.fail: unknown stage "implment"/)
    expect(workflow('bugfix').source).toBe('builtin')
  })

  it('refuses bad ids, including path traversal', () => {
    const def = clone(workflow('bugfix').def!)
    for (const id of ['../evil', 'Upper', '', 'a/b', '-x']) fails(() => store.saveWorkflow(id, def, null), 400, /Ids are/)
    fails(() => store.remove('workflow', '../../x'), 400, /Ids are/)
  })

  it("can't delete a built-in", () => {
    fails(() => store.remove('workflow', 'standard-dev'), 409, /Built-in/)
  })
})

describe('saving agents', () => {
  it('saves the role prompt next to the definition and bumps the version', () => {
    const def = clone(agent('reviewer').def!) as AgentDef
    def.model = 'haiku'
    const saved = store.saveAgent('reviewer', def, '# Strict reviewer', 1)
    expect(saved).toMatchObject({ source: 'modified', rolePrompt: '# Strict reviewer', def: { version: 2, prompt: 'reviewer.md' } })
    expect(store.load().agents.reviewer).toMatchObject({ model: 'haiku', rolePrompt: '# Strict reviewer' })
  })

  it('creates a new agent and refuses to delete it while a workflow uses it', () => {
    const def = clone(agent('reviewer').def!)
    store.saveAgent('security', def, 'You look for security issues.', null)
    const wf = clone(workflow('bugfix').def!)
    wf.stages.review = { ...wf.stages.review, agent: 'security' } as WorkflowDef['stages'][string]
    store.saveWorkflow('secure-fix', wf, null)
    expect(agent('security').usedBy).toEqual(['secure-fix'])

    fails(() => store.remove('agent', 'security'), 409, /would break workflows that use it:\nsecure-fix: /)
    store.remove('workflow', 'secure-fix')
    store.remove('agent', 'security')
    expect(agent('security')).toBeUndefined()
    expect(fs.readdirSync(path.join(user, 'agents'))).toEqual([])
  })

  it('refuses an edit that would break a workflow using the agent', () => {
    const def = clone(agent('coder').def!) as AgentDef
    delete def.modes.plan
    fails(() => store.saveAgent('coder', def, 'x', 1), 409, /standard-dev: stages.analysis.mode: agent "coder" has no mode "plan"/)

    const verdicts = clone(agent('reviewer').def!) as AgentDef
    verdicts.modes.default.outputSchema.properties!.verdict.enum = ['approved', 'changes_requested', 'unsure']
    verdicts.outcomeFromIssues = undefined
    fails(() => store.saveAgent('reviewer', verdicts, 'x', 1), 409, /missing transition for "unsure"/)
  })

  it('refuses an invalid agent', () => {
    const def = { ...clone(agent('reviewer').def!), model: 'gpt' }
    fails(() => store.saveAgent('reviewer', def, 'x', 1), 400, /model: must be one of/)
  })
})
