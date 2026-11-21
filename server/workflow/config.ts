import fs from 'node:fs'
import path from 'node:path'
import type {
  AgentDef,
  AiAgentEntry,
  AiConfig,
  AiEntrySource,
  AiWorkflowEntry,
  WorkflowDef,
  WorkflowSummary,
} from '../../src/lib/workflowTypes'
import { isObject, validateAgent, validateWorkflow } from '../../src/lib/workflowValidate'

export {
  agentOutcomes,
  stageOutcomes,
  startStage,
  validateAgent,
  validateWorkflow,
} from '../../src/lib/workflowValidate'

export type LoadedAgent = AgentDef & { rolePrompt: string }

export type WorkflowConfig = {
  workflows: Record<string, { def: WorkflowDef; errors: string[] }>
  agents: Record<string, LoadedAgent>
  /** Problems with agent files; they also invalidate workflows using them. */
  agentErrors: Record<string, string[]>
  summaries: WorkflowSummary[]
  /** Every entry with where it came from, for the AI section. */
  ai: AiConfig
}

/** Built-ins ship in the repo; the AI section saves to `user` (data/ai). */
export type ConfigDirs = { builtin: string; user?: string }

/**
 * Unsaved changes to the user layer, so a save can be checked against the
 * whole config before it's written. null removes the user file.
 */
export type ConfigOverlay = {
  workflows?: Record<string, unknown | null>
  agents?: Record<string, { def: unknown; rolePrompt: string } | null>
}

type RawEntry = { raw: unknown; rolePrompt: string | null; error: string | null; source: AiEntrySource }

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function jsonFiles(dir: string | undefined): string[] {
  if (!dir) return []
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads one layer's JSON files; agents also get their role prompt. */
function readLayer(dir: string | undefined, withPrompt: boolean): Map<string, Omit<RawEntry, 'source'>> {
  const out = new Map<string, Omit<RawEntry, 'source'>>()
  for (const file of jsonFiles(dir)) {
    const id = path.basename(file, '.json')
    try {
      const raw = readJson(path.join(dir!, file))
      let rolePrompt: string | null = null
      if (withPrompt && isObject(raw) && typeof raw.prompt === 'string') {
        try {
          rolePrompt = fs.readFileSync(path.join(dir!, path.basename(raw.prompt)), 'utf8')
        } catch {
          rolePrompt = null
        }
      }
      out.set(id, { raw, rolePrompt, error: null })
    } catch (err) {
      out.set(id, { raw: null, rolePrompt: null, error: `${file}: ${errorText(err)}` })
    }
  }
  return out
}

/** Built-in entries overlaid by the user's, sorted by id. */
function mergeLayers(
  builtin: Map<string, Omit<RawEntry, 'source'>>,
  user: Map<string, Omit<RawEntry, 'source'>>,
  overlay: Record<string, Omit<RawEntry, 'source'> | null> = {},
): Map<string, RawEntry> {
  for (const [id, entry] of Object.entries(overlay)) {
    if (entry) user.set(id, entry)
    else user.delete(id)
  }
  const out = new Map<string, RawEntry>()
  for (const id of [...new Set([...builtin.keys(), ...user.keys()])].sort()) {
    const mine = user.get(id)
    const source: AiEntrySource = mine ? (builtin.has(id) ? 'modified' : 'custom') : 'builtin'
    out.set(id, { ...(mine ?? builtin.get(id)!), source })
  }
  return out
}

/**
 * Loads workflows/*.json and workflows/agents/*.json (+ role prompt .md) from
 * the built-in folder, overlaid by the same layout in `dirs.user`, validating
 * everything. Invalid entries are kept with their errors so the UI can show
 * what's wrong.
 */
export function loadWorkflowConfig(dirs: ConfigDirs | string, overlay: ConfigOverlay = {}): WorkflowConfig {
  const { builtin, user } = typeof dirs === 'string' ? { builtin: dirs } : dirs
  const agentOverlay = Object.fromEntries(
    Object.entries(overlay.agents ?? {}).map(([id, a]) => [id, a && { raw: a.def, rolePrompt: a.rolePrompt, error: null }]),
  )
  const workflowOverlay = Object.fromEntries(
    Object.entries(overlay.workflows ?? {}).map(([id, raw]) => [id, raw === null ? null : { raw, rolePrompt: null, error: null }]),
  )
  const rawAgents = mergeLayers(
    readLayer(path.join(builtin, 'agents'), true),
    readLayer(user && path.join(user, 'agents'), true),
    agentOverlay,
  )
  const rawWorkflows = mergeLayers(readLayer(builtin, false), readLayer(user && path.join(user, 'workflows'), false), workflowOverlay)

  const agents: Record<string, LoadedAgent> = {}
  const agentErrors: Record<string, string[]> = {}
  const aiAgents: AiAgentEntry[] = []
  for (const [id, entry] of rawAgents) {
    const errors = entry.error ? [entry.error] : validateAgent(entry.raw)
    const def = entry.error ? null : (entry.raw as AgentDef)
    if (errors.length === 0 && def!.agent !== id) errors.push(`agent: must match file name "${id}"`)
    if (errors.length === 0 && entry.rolePrompt === null) errors.push(`prompt: cannot read ${def!.prompt}`)
    if (errors.length) agentErrors[id] = errors
    else agents[id] = { ...def!, rolePrompt: entry.rolePrompt! }
    aiAgents.push({ id, def, rolePrompt: entry.rolePrompt ?? '', source: entry.source, errors, usedBy: [] })
  }

  const workflows: WorkflowConfig['workflows'] = {}
  const summaries: WorkflowSummary[] = []
  const aiWorkflows: AiWorkflowEntry[] = []
  for (const [id, entry] of rawWorkflows) {
    const raw = entry.raw
    const errors = entry.error ? [entry.error] : validateWorkflow(raw, agents)
    if (!entry.error && isObject(raw) && raw.workflow !== id) errors.push(`workflow: must match file name "${id}"`)
    if (isObject(raw) && isObject(raw.stages)) {
      for (const [sid, stage] of Object.entries(raw.stages)) {
        const name = isObject(stage) && stage.type === 'agent' ? String(stage.agent) : null
        if (!name) continue
        const usedBy = aiAgents.find((a) => a.id === name)?.usedBy
        if (usedBy && !usedBy.includes(id)) usedBy.push(id)
        if (agentErrors[name]) errors.push(`stages.${sid}.agent: "${name}" is invalid (${agentErrors[name][0]})`)
      }
    }
    const def = entry.error ? null : (raw as WorkflowDef)
    workflows[id] = { def: def as WorkflowDef, errors }
    summaries.push({
      id,
      version: isObject(raw) && Number.isInteger(raw.version) ? (raw.version as number) : null,
      description: isObject(raw) && typeof raw.description === 'string' ? raw.description : '',
      valid: errors.length === 0,
      errors,
    })
    aiWorkflows.push({ id, def, source: entry.source, errors })
  }
  return { workflows, agents, agentErrors, summaries, ai: { workflows: aiWorkflows, agents: aiAgents } }
}
