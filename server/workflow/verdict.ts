import type { AgentDef, AgentModeDef, Issue, JsonSchema } from '../../src/lib/workflowTypes'

/** A validated agent result. Extra fields (plan, filesChanged, ...) are kept. */
export type Verdict = {
  verdict: string
  summary: string
  issues: Issue[]
  plan?: string
  planSteps?: string[]
  filesChanged?: string[]
  [key: string]: unknown
}

/**
 * Checks a value against the JSON Schema subset agent schemas use (type,
 * properties, required, items, enum). Returns path-style errors.
 */
export function checkSchema(value: unknown, schema: JsonSchema, at = 'output'): string[] {
  const errors: string[] = []
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${at}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`)
    return errors
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at}: must be an object`]
      const obj = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined) errors.push(`${at}.${key}: is required`)
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (obj[key] !== undefined) errors.push(...checkSchema(obj[key], sub, `${at}.${key}`))
      }
      break
    }
    case 'array':
      if (!Array.isArray(value)) return [`${at}: must be an array`]
      if (schema.items) value.forEach((v, i) => errors.push(...checkSchema(v, schema.items!, `${at}[${i}]`)))
      break
    case 'string':
      if (typeof value !== 'string') errors.push(`${at}: must be a string`)
      break
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${at}: must be an integer`)
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${at}: must be a number`)
      break
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${at}: must be a boolean`)
      break
  }
  return errors
}

/** Validates an agent's structured output. A JSON string is parsed first. */
export function parseVerdict(
  raw: unknown,
  mode: AgentModeDef,
): { ok: true; verdict: Verdict } | { ok: false; errors: string[] } {
  if (raw == null || raw === '') return { ok: false, errors: ['No structured output was returned.'] }
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, errors: ['Structured output is not valid JSON.'] }
    }
  }
  const errors = checkSchema(value, mode.outputSchema)
  if (errors.length) return { ok: false, errors }
  const v = value as Verdict
  return { ok: true, verdict: { ...v, issues: Array.isArray(v.issues) ? v.issues : [] } }
}

/**
 * The outcome the engine acts on. Agents with `outcomeFromIssues` get their
 * outcome from issue severities (e.g. only blocker/major request changes);
 * `normalized` says the agent's own verdict was overridden.
 */
export function decideOutcome(agent: AgentDef, verdict: Verdict): { outcome: string; normalized: boolean } {
  const rule = agent.outcomeFromIssues
  if (!rule) return { outcome: verdict.verdict, normalized: false }
  const blocked = verdict.issues.some((i) => rule.blocking.includes(i.severity))
  const outcome = blocked ? rule.blocked : rule.clear
  return { outcome, normalized: outcome !== verdict.verdict }
}
