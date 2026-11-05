import fs from 'node:fs'
import path from 'node:path'
import type { AgentDef, WorkflowDef, WorkflowSummary } from '../../src/lib/workflowTypes'
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
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function jsonFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

/**
 * Loads workflows/*.json and workflows/agents/*.json (+ role prompt .md) from
 * `dir`, validating everything. Invalid entries are kept with their errors so
 * the UI can show what's wrong.
 */
export function loadWorkflowConfig(dir: string): WorkflowConfig {
  const agentsDir = path.join(dir, 'agents')
  const agents: Record<string, LoadedAgent> = {}
  const agentErrors: Record<string, string[]> = {}
  for (const file of jsonFiles(agentsDir)) {
    const name = path.basename(file, '.json')
    let raw: unknown
    try {
      raw = readJson(path.join(agentsDir, file))
    } catch (err) {
      agentErrors[name] = [`${file}: ${err instanceof Error ? err.message : String(err)}`]
      continue
    }
    const errors = validateAgent(raw)
    const def = raw as AgentDef
    if (errors.length === 0 && def.agent !== name) errors.push(`agent: must match file name "${name}"`)
    let rolePrompt = ''
    if (errors.length === 0) {
      try {
        rolePrompt = fs.readFileSync(path.join(agentsDir, def.prompt), 'utf8')
      } catch {
        errors.push(`prompt: cannot read ${def.prompt}`)
      }
    }
    if (errors.length) agentErrors[name] = errors
    else agents[name] = { ...def, rolePrompt }
  }

  const workflows: WorkflowConfig['workflows'] = {}
  const summaries: WorkflowSummary[] = []
  for (const file of jsonFiles(dir)) {
    const id = path.basename(file, '.json')
    let raw: unknown
    let errors: string[]
    try {
      raw = readJson(path.join(dir, file))
      errors = validateWorkflow(raw, agents)
      if (isObject(raw) && raw.workflow !== id) errors.push(`workflow: must match file name "${id}"`)
      if (isObject(raw) && isObject(raw.stages)) {
        for (const [sid, stage] of Object.entries(raw.stages)) {
          const name = isObject(stage) && stage.type === 'agent' ? String(stage.agent) : null
          if (name && agentErrors[name]) errors.push(`stages.${sid}.agent: "${name}" is invalid (${agentErrors[name][0]})`)
        }
      }
    } catch (err) {
      raw = null
      errors = [`${file}: ${err instanceof Error ? err.message : String(err)}`]
    }
    const def = raw as WorkflowDef
    workflows[id] = { def, errors }
    summaries.push({
      id,
      version: isObject(raw) && Number.isInteger(raw.version) ? (raw.version as number) : null,
      description: isObject(raw) && typeof raw.description === 'string' ? raw.description : '',
      valid: errors.length === 0,
      errors,
    })
  }
  return { workflows, agents, agentErrors, summaries }
}
