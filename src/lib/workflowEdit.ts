/**
 * Pure edits for the AI section's workflow form. Each returns a new
 * definition; validation stays in workflowValidate.ts.
 */
import { DONE, type AgentDef, type StageDef, type StageType, type WorkflowDef } from './workflowTypes'
import { stageOutcomes, startStage } from './workflowValidate'

export function blankWorkflow(id: string): WorkflowDef {
  return {
    workflow: id,
    version: 1,
    description: '',
    stages: {},
    limits: { max_loops: 3, max_cost_usd: 5, timeout_minutes: 60 },
  }
}

/** Gives a stage exactly the transitions its outcomes need, keeping targets already set. */
export function syncTransitions(stage: StageDef, agents: Record<string, AgentDef>): StageDef {
  const outcomes = stageOutcomes(stage, agents)
  if (!outcomes) return stage
  const next = Object.fromEntries(outcomes.map((o) => [o, stage.next[o] ?? DONE]))
  return { ...stage, next }
}

/** A new stage of `type` with sensible defaults. */
export function newStage(type: StageType, agents: Record<string, AgentDef>): StageDef {
  if (type === 'command') return { type, run: '{{project.ciCommand}}', next: { pass: DONE, fail: DONE } }
  if (type === 'gate') return { type, show: 'diff', next: { approved: DONE, rejected: DONE } }
  const agent = Object.values(agents)[0]
  const mode = agent ? Object.keys(agent.modes)[0] : 'default'
  return syncTransitions({ type, agent: agent?.agent ?? '', mode, next: {} }, agents)
}

/** A stage id not used yet, based on `base`. */
export function freeStageId(def: WorkflowDef, base: string): string {
  if (!(base in def.stages) && base !== DONE) return base
  for (let n = 2; ; n++) if (!(`${base}_${n}` in def.stages)) return `${base}_${n}`
}

export function setStage(def: WorkflowDef, id: string, stage: StageDef): WorkflowDef {
  return { ...def, stages: { ...def.stages, [id]: stage } }
}

/** Renames a stage in place, updating every transition and `start` that pointed to it. */
export function renameStage(def: WorkflowDef, from: string, to: string): WorkflowDef {
  if (from === to) return def
  const retarget = (t: string) => (t === from ? to : t)
  const stages = Object.fromEntries(
    Object.entries(def.stages).map(([id, s]) => [
      id === from ? to : id,
      { ...s, next: Object.fromEntries(Object.entries(s.next).map(([o, t]) => [o, retarget(t)])) },
    ]),
  )
  return { ...def, ...(def.start ? { start: retarget(def.start) } : {}), stages }
}

/** Removes a stage. Transitions that pointed to it are left for validation to flag. */
export function removeStage(def: WorkflowDef, id: string): WorkflowDef {
  const stages = { ...def.stages }
  delete stages[id]
  const next = { ...def, stages }
  if (next.start === id) delete next.start
  return next
}

export function moveStage(def: WorkflowDef, id: string, by: -1 | 1): WorkflowDef {
  const ids = Object.keys(def.stages)
  const i = ids.indexOf(id)
  const j = i + by
  if (i < 0 || j < 0 || j >= ids.length) return def
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return { ...def, stages: Object.fromEntries(ids.map((k) => [k, def.stages[k]])) }
}

/**
 * One line showing the main path and where outcomes loop back, e.g.
 * "implement → ci (fail ↺ implement) → review → done".
 */
export function flowPreview(def: WorkflowDef): string {
  const ids = Object.keys(def.stages)
  if (ids.length === 0) return ''
  const parts: string[] = []
  const seen = new Set<string>()
  let id: string | undefined = startStage(def)
  while (id && id !== DONE && def.stages[id] && !seen.has(id)) {
    seen.add(id)
    const entries: [string, string][] = Object.entries(def.stages[id].next)
    const back = entries.filter(([, t]) => seen.has(t)).map(([o, t]) => `${o} ↺ ${t}`)
    parts.push(back.length ? `${id} (${back.join(', ')})` : id)
    id = entries.find(([, t]) => !seen.has(t))?.[1]
  }
  if (id === DONE) parts.push(DONE)
  return parts.join(' → ')
}
