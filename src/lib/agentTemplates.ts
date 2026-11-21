/**
 * Building blocks for the AI section's agent editor: output schemas from
 * templates, tool presets, starter agents and config warnings. Shared with
 * the tests; keep this file free of DOM or Node imports.
 */
import { BASELINE_DISALLOWED_TOOLS, type AgentDef, type AgentModeDef, type JsonSchema, type OutcomeFromIssues, type PermissionMode } from './workflowTypes'

// ---- output schemas ----

/** Fields beyond verdict and summary that the engine understands. */
export type OutputField = 'plan' | 'filesChanged' | 'issues'

export type OutputTemplateId = 'plan' | 'implement' | 'review' | 'check' | 'custom'

export const OUTPUT_TEMPLATES: Record<
  Exclude<OutputTemplateId, 'custom'>,
  { label: string; description: string; verdicts: string[]; fields: OutputField[]; severityRule?: OutcomeFromIssues }
> = {
  plan: {
    label: 'Plan',
    description: 'Returns a markdown plan and its steps. A plan gate shows it for approval.',
    verdicts: ['done'],
    fields: ['plan'],
  },
  implement: {
    label: 'Implement',
    description: 'Reports what changed and which files.',
    verdicts: ['done'],
    fields: ['filesChanged'],
  },
  review: {
    label: 'Review',
    description: 'Approves or requests changes, with issues by severity.',
    verdicts: ['approved', 'changes_requested'],
    fields: ['issues'],
    severityRule: { blocking: ['blocker', 'major'], blocked: 'changes_requested', clear: 'approved' },
  },
  check: {
    label: 'Check',
    description: 'Passes or fails, with issues by severity (e.g. QA).',
    verdicts: ['pass', 'fail'],
    fields: ['issues'],
    severityRule: { blocking: ['blocker', 'major'], blocked: 'fail', clear: 'pass' },
  },
}

const ISSUES_SCHEMA: JsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      file: { type: 'string' },
      line: { type: 'integer' },
      description: { type: 'string' },
    },
    required: ['severity', 'description'],
  },
}

/** The output schema for a set of verdicts and fields. */
export function buildOutputSchema(verdicts: string[], fields: OutputField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    verdict: { type: 'string', enum: verdicts },
    summary: { type: 'string', description: 'What you did or found, 1-5 sentences.' },
  }
  const required = ['verdict', 'summary']
  if (fields.includes('plan')) {
    properties.plan = { type: 'string', description: 'The implementation plan in markdown.' }
    properties.planSteps = { type: 'array', items: { type: 'string' } }
    required.push('plan', 'planSteps')
  }
  if (fields.includes('filesChanged')) {
    properties.filesChanged = { type: 'array', items: { type: 'string' } }
    required.push('filesChanged')
  }
  if (fields.includes('issues')) {
    properties.issues = ISSUES_SCHEMA
    required.push('issues')
  }
  return { type: 'object', properties, required }
}

/** Schema with descriptions removed, for comparing shapes. */
function shape(schema: JsonSchema | undefined): unknown {
  if (!schema) return null
  const { description: _description, properties, items, required, ...rest } = schema
  return {
    ...rest,
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, shape(v)])) } : {}),
    ...(items ? { items: shape(items) } : {}),
    ...(required ? { required: [...required].sort() } : {}),
  }
}

function sameShape(a: JsonSchema, b: JsonSchema): boolean {
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b))
}

export type OutputDescription = { template: OutputTemplateId; verdicts: string[]; fields: OutputField[] }

/**
 * Reads a mode's schema back into template terms, or null when it was
 * hand-written in a way the form can't represent (edit it as JSON).
 */
export function describeOutput(schema: JsonSchema): OutputDescription | null {
  const verdicts = schema.properties?.verdict?.enum?.map(String)
  if (!verdicts?.length) return null
  const props = schema.properties ?? {}
  const fields = (['plan', 'filesChanged', 'issues'] as const).filter((f) => f in props)
  if (!sameShape(schema, buildOutputSchema(verdicts, fields))) return null
  const match = Object.entries(OUTPUT_TEMPLATES).find(
    ([, t]) => t.verdicts.join() === verdicts.join() && t.fields.join() === fields.join(),
  )
  return { template: (match?.[0] as OutputTemplateId | undefined) ?? 'custom', verdicts, fields }
}

// ---- tools and permissions ----

export type ToolPreset = {
  label: string
  description: string
  permissionMode: PermissionMode
  allowedTools: string[]
  disallowedTools: string[]
}

const NO_EDITS = ['Edit', 'Write', 'NotebookEdit']
const GIT_READ = ['Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)']

export const TOOL_PRESETS: Record<string, ToolPreset> = {
  plan: {
    label: 'Plan only',
    description: "Claude's plan mode: reads the code, changes nothing.",
    permissionMode: 'plan',
    allowedTools: [],
    disallowedTools: NO_EDITS,
  },
  readOnly: {
    label: 'Read-only',
    description: 'Reads and searches files. No edits, no shell.',
    permissionMode: 'default',
    allowedTools: ['Read', 'Grep', 'Glob'],
    disallowedTools: NO_EDITS,
  },
  readGit: {
    label: 'Read + git inspection',
    description: 'Read-only, plus git diff, log, show and status.',
    permissionMode: 'default',
    allowedTools: ['Read', 'Grep', 'Glob', ...GIT_READ],
    disallowedTools: NO_EDITS,
  },
  runChecks: {
    label: 'Read + run commands',
    description: 'Reads files and runs shell commands (tests, builds), but never edits.',
    permissionMode: 'default',
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
    disallowedTools: [...NO_EDITS, 'Bash(git commit:*)'],
  },
  editCode: {
    label: 'Edit code',
    description: 'Edits files and runs commands. The app commits after the stage.',
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    disallowedTools: ['Bash(git commit:*)'],
  },
}

/** Applies a preset's permissions to a mode, keeping its instructions and output. */
export function applyPreset(mode: AgentModeDef, preset: ToolPreset): AgentModeDef {
  return {
    ...mode,
    permissionMode: preset.permissionMode,
    allowedTools: [...preset.allowedTools],
    disallowedTools: [...preset.disallowedTools],
  }
}

/** Denials every session gets anyway, so the editor can show them as locked. */
export function isBaselineRule(rule: string): boolean {
  return BASELINE_DISALLOWED_TOOLS.includes(rule)
}

// ---- warnings ----

const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']
const JUDGING_VERDICTS = ['approved', 'changes_requested', 'pass', 'fail']

/** Risky but valid settings, shown next to the mode; they don't block saving. */
export function modeWarnings(mode: AgentModeDef): string[] {
  const warnings: string[] = []
  const allowed = mode.allowedTools ?? []
  const denied = mode.disallowedTools ?? []
  const verdicts = mode.outputSchema.properties?.verdict?.enum?.map(String) ?? []
  const canEdit =
    mode.permissionMode === 'acceptEdits' || allowed.some((t) => EDIT_TOOLS.includes(t) && !denied.includes(t))
  if (canEdit && verdicts.some((v) => JUDGING_VERDICTS.includes(v))) {
    warnings.push('This mode judges work but can also edit files. Reviewers and checkers are usually read-only.')
  }
  if (allowed.includes('Bash')) {
    warnings.push('Bash is allowed without a pattern, so any shell command can run (the locked denials still apply).')
  }
  return warnings
}

// ---- starter agents ----

export type StarterAgent = { label: string; description: string; build: (id: string) => { def: AgentDef; rolePrompt: string } }

function mode(preset: ToolPreset, instructions: string, verdicts: string[], fields: OutputField[]): AgentModeDef {
  return applyPreset({ permissionMode: 'default', instructions, outputSchema: buildOutputSchema(verdicts, fields) }, preset)
}

export const STARTER_AGENTS: Record<'reviewer' | 'qa' | 'blank', StarterAgent> = {
  reviewer: {
    label: 'Reviewer-like',
    description: 'Read-only, approves or requests changes.',
    build: (id) => ({
      def: {
        agent: id,
        prompt: `${id}.md`,
        outcomeFromIssues: OUTPUT_TEMPLATES.review.severityRule,
        modes: {
          default: mode(
            TOOL_PRESETS.readGit,
            'Review the branch diff (run the git diff command given above) against the ticket and the approved plan.',
            OUTPUT_TEMPLATES.review.verdicts,
            ['issues'],
          ),
        },
      },
      rolePrompt: `You are a careful code reviewer working in a git repository.\n\nReport each problem as an issue with a severity: blocker (must fix: bugs, data loss, security), major (should fix before merging) or minor (nice to have). You never edit files.\n`,
    }),
  },
  qa: {
    label: 'QA-like',
    description: 'Runs commands to check the change works; passes or fails.',
    build: (id) => ({
      def: {
        agent: id,
        prompt: `${id}.md`,
        outcomeFromIssues: OUTPUT_TEMPLATES.check.severityRule,
        modes: {
          default: mode(
            TOOL_PRESETS.runChecks,
            'Check that the change does what the ticket asks: build it, run it, and try the important cases. Report each problem as an issue.',
            OUTPUT_TEMPLATES.check.verdicts,
            ['issues'],
          ),
        },
      },
      rolePrompt: `You are a QA engineer. You verify behaviour by running things, not by reading code alone. You never edit files.\n`,
    }),
  },
  blank: {
    label: 'Blank',
    description: 'One read-only mode that reports "done".',
    build: (id) => ({
      def: {
        agent: id,
        prompt: `${id}.md`,
        modes: { default: mode(TOOL_PRESETS.readOnly, 'Describe what this mode should do.', ['done'], []) },
      },
      rolePrompt: `You are ${id}, an agent in a multi-stage workflow.\n`,
    }),
  },
}

// ---- severity rule ----

function verdictsOf(def: AgentDef): string[][] {
  return Object.values(def.modes).map((m) => m.outputSchema.properties?.verdict?.enum?.map(String) ?? [])
}

/**
 * Keeps `outcomeFromIssues` valid after the modes change: a rule naming
 * verdicts some mode no longer has is swapped for a template rule that fits,
 * or dropped. `suggest` adds a template's rule when there is none.
 */
export function fitSeverityRule(def: AgentDef, suggest?: OutcomeFromIssues): AgentDef {
  const all = verdictsOf(def)
  const fits = (r: OutcomeFromIssues) => all.every((v) => v.includes(r.blocked) && v.includes(r.clear))
  const rule = def.outcomeFromIssues
  if (rule && fits(rule)) return def
  const replacement = [suggest, ...Object.values(OUTPUT_TEMPLATES).map((t) => t.severityRule)].find(
    (r): r is OutcomeFromIssues => Boolean(r && fits(r)),
  )
  if (!rule && !suggest) return def
  const { outcomeFromIssues: _old, ...rest } = def
  return replacement ? { ...rest, outcomeFromIssues: { ...replacement, blocking: rule?.blocking ?? replacement.blocking } } : rest
}
