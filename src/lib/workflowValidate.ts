/**
 * Pure checks for workflow and agent definitions, shared by the local API
 * server and the AI section's editors. Keep this file free of DOM or Node
 * imports.
 */
import {
  DONE,
  type AgentDef,
  type IssueSeverity,
  type PermissionMode,
  type StageDef,
  type StageType,
  type WorkflowDef,
} from './workflowTypes'
import { CLAUDE_EFFORTS, CLAUDE_MODELS, type ClaudeEffort, type ClaudeModel } from './types'

export const STAGE_TYPES: StageType[] = ['agent', 'command', 'gate']
export const PERMISSION_MODES: PermissionMode[] = ['plan', 'default', 'acceptEdits']
export const SEVERITIES: IssueSeverity[] = ['blocker', 'major', 'minor']
const FIXED_OUTCOMES: Record<string, string[]> = {
  command: ['pass', 'fail'],
  gate: ['approved', 'rejected'],
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The outcomes an agent mode can return: its schema's `verdict` enum. */
export function agentOutcomes(agent: AgentDef, mode: string): string[] | null {
  const verdict = agent.modes[mode]?.outputSchema?.properties?.verdict
  if (!verdict?.enum) return null
  return verdict.enum.map(String)
}

/** Every outcome a stage must have a transition for, or null if unknown. */
export function stageOutcomes(stage: StageDef, agents: Record<string, AgentDef>): string[] | null {
  if (stage.type !== 'agent') return FIXED_OUTCOMES[stage.type] ?? null
  const agent = agents[stage.agent]
  return agent ? agentOutcomes(agent, stage.mode ?? 'default') : null
}

export function startStage(def: WorkflowDef): string {
  return def.start ?? Object.keys(def.stages)[0]
}

/** Checks an agent definition's shape. Returns path-style error messages. */
export function validateAgent(raw: unknown): string[] {
  const errors: string[] = []
  if (!isObject(raw)) return ['agent definition must be an object']
  if (typeof raw.agent !== 'string' || !raw.agent) errors.push('agent: required string')
  if (typeof raw.prompt !== 'string' || !raw.prompt) errors.push('prompt: required markdown file name')
  if (raw.version !== undefined && (!Number.isInteger(raw.version) || (raw.version as number) < 1)) {
    errors.push('version: must be a positive integer')
  }
  if (raw.model !== undefined && !CLAUDE_MODELS.includes(raw.model as ClaudeModel)) {
    errors.push(`model: must be one of ${CLAUDE_MODELS.join(', ')}`)
  }
  if (raw.effort !== undefined && !CLAUDE_EFFORTS.includes(raw.effort as ClaudeEffort)) {
    errors.push(`effort: must be one of ${CLAUDE_EFFORTS.join(', ')}`)
  }
  if (!isObject(raw.modes) || Object.keys(raw.modes).length === 0) {
    errors.push('modes: at least one mode is required')
    return errors
  }
  for (const [name, mode] of Object.entries(raw.modes)) {
    const at = `modes.${name}`
    if (!isObject(mode)) {
      errors.push(`${at}: must be an object`)
      continue
    }
    if (!PERMISSION_MODES.includes(mode.permissionMode as PermissionMode)) {
      errors.push(`${at}.permissionMode: must be one of ${PERMISSION_MODES.join(', ')}`)
    }
    for (const key of ['allowedTools', 'disallowedTools']) {
      const v = mode[key]
      if (v !== undefined && !(Array.isArray(v) && v.every((t) => typeof t === 'string'))) {
        errors.push(`${at}.${key}: must be a list of tool rules`)
      }
    }
    if (typeof mode.instructions !== 'string') errors.push(`${at}.instructions: required string`)
    const schema = mode.outputSchema
    if (!isObject(schema) || schema.type !== 'object' || !isObject(schema.properties)) {
      errors.push(`${at}.outputSchema: must be an object schema with properties`)
      continue
    }
    const props = schema.properties as Record<string, Record<string, unknown>>
    const required = Array.isArray(schema.required) ? schema.required : []
    const verdict = props.verdict
    if (!verdict || verdict.type !== 'string' || !Array.isArray(verdict.enum) || verdict.enum.length === 0) {
      errors.push(`${at}.outputSchema.properties.verdict: must be a string enum of outcomes`)
    }
    if (props.summary?.type !== 'string') errors.push(`${at}.outputSchema.properties.summary: must be a string`)
    for (const key of ['verdict', 'summary']) {
      if (!required.includes(key)) errors.push(`${at}.outputSchema.required: must include "${key}"`)
    }
  }
  const rule = raw.outcomeFromIssues
  if (rule !== undefined) {
    if (
      !isObject(rule) ||
      !Array.isArray(rule.blocking) ||
      !rule.blocking.every((s) => SEVERITIES.includes(s as IssueSeverity)) ||
      typeof rule.blocked !== 'string' ||
      typeof rule.clear !== 'string'
    ) {
      errors.push('outcomeFromIssues: needs blocking (severities), blocked and clear outcomes')
    } else {
      for (const [name] of Object.entries(raw.modes)) {
        const outcomes = agentOutcomes(raw as AgentDef, name) ?? []
        for (const o of [rule.blocked, rule.clear] as string[]) {
          if (!outcomes.includes(o)) errors.push(`outcomeFromIssues: "${o}" is not a verdict of mode ${name}`)
        }
      }
    }
  }
  return errors
}

/**
 * Checks a workflow against the loaded agents: shape and limits, unknown
 * stages/agents/modes, missing or unknown transitions, unreachable stages,
 * and stages that can never reach `done` (loops with no exit).
 */
export function validateWorkflow(raw: unknown, agents: Record<string, AgentDef>): string[] {
  const errors: string[] = []
  if (!isObject(raw)) return ['workflow must be an object']
  if (typeof raw.workflow !== 'string' || !raw.workflow) errors.push('workflow: required name')
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) errors.push('version: must be a positive integer')

  const limits = raw.limits
  if (!isObject(limits)) {
    errors.push('limits: required (max_loops, max_cost_usd, timeout_minutes)')
  } else {
    if (!Number.isInteger(limits.max_loops) || (limits.max_loops as number) < 0) {
      errors.push('limits.max_loops: must be a non-negative integer')
    }
    for (const key of ['max_cost_usd', 'timeout_minutes']) {
      if (typeof limits[key] !== 'number' || !((limits[key] as number) > 0)) {
        errors.push(`limits.${key}: must be a positive number`)
      }
    }
  }

  if (!isObject(raw.stages) || Object.keys(raw.stages).length === 0) {
    errors.push('stages: at least one stage is required')
    return errors
  }
  const stages = raw.stages as Record<string, unknown>
  const ids = Object.keys(stages)
  if (ids.includes(DONE)) errors.push(`stages.${DONE}: "${DONE}" is reserved for the end of the workflow`)
  const start = raw.start ?? ids[0]
  if (typeof start !== 'string' || !ids.includes(start)) errors.push(`start: unknown stage "${String(start)}"`)

  // Edges for the reachability checks; only valid targets are kept.
  const edges: Record<string, string[]> = {}
  for (const [id, stage] of Object.entries(stages)) {
    const at = `stages.${id}`
    edges[id] = []
    if (!isObject(stage)) {
      errors.push(`${at}: must be an object`)
      continue
    }
    if (!STAGE_TYPES.includes(stage.type as StageType)) {
      errors.push(`${at}.type: must be one of ${STAGE_TYPES.join(', ')}`)
      continue
    }
    if (stage.type === 'agent') {
      const agent = typeof stage.agent === 'string' ? agents[stage.agent] : undefined
      if (!agent) errors.push(`${at}.agent: unknown agent "${String(stage.agent)}"`)
      else if (!agent.modes[(stage.mode as string | undefined) ?? 'default']) {
        errors.push(`${at}.mode: agent "${agent.agent}" has no mode "${String(stage.mode ?? 'default')}"`)
      }
    }
    if (stage.type === 'command' && (typeof stage.run !== 'string' || !stage.run.trim())) {
      errors.push(`${at}.run: required command`)
    }
    if (stage.type === 'gate' && stage.show !== undefined && stage.show !== 'plan' && stage.show !== 'diff') {
      errors.push(`${at}.show: must be "plan" or "diff"`)
    }
    if (!isObject(stage.next)) {
      errors.push(`${at}.next: required map of outcome to stage`)
      continue
    }
    const outcomes = stageOutcomes(stage as StageDef, agents)
    for (const [outcome, target] of Object.entries(stage.next)) {
      if (outcomes && !outcomes.includes(outcome)) {
        errors.push(`${at}.next.${outcome}: not an outcome of this stage (expected ${outcomes.join(', ')})`)
      }
      if (typeof target !== 'string' || (target !== DONE && !ids.includes(target))) {
        errors.push(`${at}.next.${outcome}: unknown stage "${String(target)}"`)
      } else {
        edges[id].push(target)
      }
    }
    for (const outcome of outcomes ?? []) {
      if (!(outcome in stage.next)) errors.push(`${at}.next: missing transition for "${outcome}"`)
    }
  }

  if (typeof start === 'string' && ids.includes(start)) {
    const reached = walk([start], (id) => edges[id] ?? [])
    for (const id of ids) if (!reached.has(id)) errors.push(`stages.${id}: unreachable from "${start}"`)
  }
  const reverse: Record<string, string[]> = { [DONE]: [] }
  for (const id of ids) reverse[id] = []
  for (const [from, targets] of Object.entries(edges)) for (const to of targets) reverse[to].push(from)
  const exits = walk([DONE], (id) => reverse[id] ?? [])
  for (const id of ids) if (!exits.has(id)) errors.push(`stages.${id}: can never reach "${DONE}" (loop with no exit)`)
  return errors
}

function walk(from: string[], next: (id: string) => string[]): Set<string> {
  const seen = new Set(from)
  const queue = [...from]
  while (queue.length) {
    for (const n of next(queue.shift()!)) {
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return seen
}
