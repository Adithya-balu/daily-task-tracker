import fs from 'node:fs'
import path from 'node:path'
import { AI_ID, type AgentDef, type AiAgentEntry, type AiWorkflowEntry, type WorkflowDef } from '../../src/lib/workflowTypes'
import { isObject } from '../../src/lib/workflowValidate'
import { writeFileAtomic } from '../store'
import { loadWorkflowConfig, type ConfigDirs, type ConfigOverlay, type WorkflowConfig } from './config'
import { WorkflowError } from './engine'

type Kind = 'workflow' | 'agent'

/**
 * Saves and removes the AI section's edits in `dirs.user` (data/ai), on top
 * of the built-ins in `dirs.builtin`. Nothing invalid is ever written: each
 * change is checked against the whole merged config first, so an agent edit
 * can't silently break a workflow that uses it.
 */
export class AiConfigStore {
  constructor(private readonly dirs: Required<ConfigDirs>) {}

  load(overlay?: ConfigOverlay): WorkflowConfig {
    return loadWorkflowConfig(this.dirs, overlay)
  }

  /**
   * Creates (`baseVersion` null) or updates a workflow. The stored version is
   * always one past the highest this id has had, even across resets.
   */
  saveWorkflow(id: string, raw: unknown, baseVersion: number | null): AiWorkflowEntry {
    checkId(id)
    const before = this.load()
    const current = before.ai.workflows.find((w) => w.id === id)
    this.checkBase('workflow', id, current?.def?.version ?? 0, Boolean(current), baseVersion)
    if (!isObject(raw)) throw new WorkflowError(400, 'Workflow must be an object.')
    const version = this.nextVersion('workflow', id, current?.def?.version ?? 0)
    const def = { ...raw, workflow: id, version } as WorkflowDef

    const after = this.load({ workflows: { [id]: def } })
    const errors = after.workflows[id].errors
    if (errors.length) throw new WorkflowError(400, `Workflow "${id}" is invalid:\n${errors.join('\n')}`)
    writeFileAtomic(this.file('workflow', id), `${JSON.stringify(def, null, 2)}\n`)
    this.recordVersion('workflow', id, version)
    return this.load().ai.workflows.find((w) => w.id === id)!
  }

  saveAgent(id: string, raw: unknown, rolePrompt: string, baseVersion: number | null): AiAgentEntry {
    checkId(id)
    const before = this.load()
    const current = before.ai.agents.find((a) => a.id === id)
    this.checkBase('agent', id, current?.def?.version ?? 0, Boolean(current), baseVersion)
    if (!isObject(raw)) throw new WorkflowError(400, 'Agent must be an object.')
    if (typeof rolePrompt !== 'string') throw new WorkflowError(400, 'Role prompt must be text.')
    const version = this.nextVersion('agent', id, current?.def?.version ?? 0)
    const def = { ...raw, agent: id, version, prompt: `${id}.md` } as AgentDef

    const after = this.load({ agents: { [id]: { def, rolePrompt } } })
    const errors = after.agentErrors[id] ?? []
    if (errors.length) throw new WorkflowError(400, `Agent "${id}" is invalid:\n${errors.join('\n')}`)
    this.checkNothingBreaks(before, after, `Saving agent "${id}"`)
    writeFileAtomic(this.file('agent', id), `${JSON.stringify(def, null, 2)}\n`)
    writeFileAtomic(path.join(this.dirs.user, 'agents', `${id}.md`), rolePrompt)
    this.recordVersion('agent', id, version)
    return this.load().ai.agents.find((a) => a.id === id)!
  }

  /** Deletes a custom entry, or resets a modified built-in to its default. */
  remove(kind: Kind, id: string): void {
    checkId(id)
    const before = this.load()
    const entry =
      kind === 'workflow' ? before.ai.workflows.find((w) => w.id === id) : before.ai.agents.find((a) => a.id === id)
    if (!entry) throw new WorkflowError(404, `Unknown ${kind}: ${id}`)
    if (entry.source === 'builtin') {
      throw new WorkflowError(409, `Built-in ${kind}s can't be deleted, only edited and reset.`)
    }
    if (kind === 'agent') {
      const after = this.load({ agents: { [id]: null } })
      const verb = entry.source === 'custom' ? 'Deleting' : 'Resetting'
      this.checkNothingBreaks(before, after, `${verb} agent "${id}"`)
      fs.rmSync(path.join(this.dirs.user, 'agents', `${id}.md`), { force: true })
    }
    fs.rmSync(this.file(kind, id), { force: true })
  }

  private file(kind: Kind, id: string): string {
    return path.join(this.dirs.user, kind === 'workflow' ? 'workflows' : 'agents', `${id}.json`)
  }

  private checkBase(kind: Kind, id: string, version: number, exists: boolean, baseVersion: number | null): void {
    if (baseVersion === null) {
      if (exists) throw new WorkflowError(409, `A ${kind} called "${id}" already exists.`)
      return
    }
    if (!exists) throw new WorkflowError(404, `Unknown ${kind}: ${id}`)
    if (baseVersion !== version) {
      throw new WorkflowError(409, `This ${kind} was changed elsewhere (now version ${version}). Reload to see it.`)
    }
  }

  /** Workflows that were valid must stay valid. */
  private checkNothingBreaks(before: WorkflowConfig, after: WorkflowConfig, what: string): void {
    const broken = Object.entries(after.workflows)
      .filter(([wid, w]) => w.errors.length && before.workflows[wid]?.errors.length === 0)
      .map(([wid, w]) => `${wid}: ${w.errors[0]}`)
    if (broken.length) {
      throw new WorkflowError(409, `${what} would break workflows that use it:\n${broken.join('\n')}`)
    }
  }

  private versionsFile(): string {
    return path.join(this.dirs.user, 'versions.json')
  }

  private highWater(): Record<string, number> {
    try {
      return JSON.parse(fs.readFileSync(this.versionsFile(), 'utf8')) as Record<string, number>
    } catch {
      return {}
    }
  }

  private nextVersion(kind: Kind, id: string, current: number): number {
    return Math.max(current, this.highWater()[`${kind}:${id}`] ?? 0) + 1
  }

  private recordVersion(kind: Kind, id: string, version: number): void {
    writeFileAtomic(this.versionsFile(), JSON.stringify({ ...this.highWater(), [`${kind}:${id}`]: version }, null, 2))
  }
}

function checkId(id: string): void {
  if (!AI_ID.test(id)) {
    throw new WorkflowError(400, 'Ids are lowercase letters, digits, "-" and "_", starting with a letter or digit.')
  }
}
