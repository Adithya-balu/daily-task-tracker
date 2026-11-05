import type { AgentState, RunMode, RunRequest } from './agentTypes'
import { DEFAULT_CLAUDE_CONFIG, type ClaudeConfig, type Project, type Reference, type Task } from './types'

export type ResolvedClaudeConfig = typeof DEFAULT_CLAUDE_CONFIG

/** Copies only fields that are actually set, so undefined never masks a parent value. */
function overlay(base: ResolvedClaudeConfig, layer: ClaudeConfig | undefined): ResolvedClaudeConfig {
  const out = { ...base }
  if (!layer) return out
  for (const [k, v] of Object.entries(layer)) {
    if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v
  }
  return out
}

/** App defaults ← project defaults (incl. its folder) ← task overrides. */
export function resolveProjectConfig(project: Project | null | undefined): ResolvedClaudeConfig {
  const withProject = overlay(DEFAULT_CLAUDE_CONFIG, project?.claude)
  if (project?.workingDir) withProject.workingDir = project.workingDir
  return withProject
}

export function resolveConfig(task: Task, project: Project | null | undefined): ResolvedClaudeConfig {
  return overlay(resolveProjectConfig(project), task.claude)
}

/** References sent to Claude: the project's, then the task's own. */
export function contextReferences(task: Task, project: Project | null | undefined): Reference[] {
  return [...(project?.references ?? []), ...task.references].filter((r) => r.includeInContext)
}

/**
 * What a run is for:
 * - start:    fresh session (plan or execute depending on settings)
 * - approve:  continue the session after you approved its plan
 * - continue: continue the session with a message
 * - revise:   continue in plan mode, asking for a changed plan
 */
export type RunKind = 'start' | 'approve' | 'continue' | 'revise'

export function modeFor(kind: RunKind, config: ResolvedClaudeConfig): RunMode {
  if (kind === 'revise') return 'plan'
  if (kind === 'start') return config.planFirst ? 'plan' : 'execute'
  return 'execute'
}

function planSection(task: Task): string {
  if (task.plan.length === 0) return ''
  const lines = task.plan.map((s, i) => {
    const box = s.status === 'done' ? '[x]' : s.status === 'doing' ? '[~]' : '[ ]'
    const who = s.owner === 'me' ? ' (the user does this step; do not do it)' : ''
    return `${i + 1}. ${box} ${s.text}${who}`
  })
  return `## Plan\n${lines.join('\n')}`
}

export function referencesSection(refs: Reference[]): string {
  if (refs.length === 0) return ''
  const lines = refs.map((r) => {
    const label = r.label.trim() ? `${r.label.trim()}: ` : ''
    if (r.kind === 'snippet') return `- ${label || 'Snippet:'}\n\n\`\`\`\n${r.value}\n\`\`\``
    if (r.kind === 'url') return `- ${label}${r.value} (fetch it if relevant)`
    return `- ${label}${r.value} (local file or folder; read it if relevant)`
  })
  return `## References\n${lines.join('\n')}`
}

/** Builds the prompt for a run. The Claude tab previews exactly this text. */
export function buildPrompt(
  task: Task,
  project: Project | null | undefined,
  kind: RunKind,
  message: string,
): string {
  const msg = message.trim()
  const plan = planSection(task)

  if (kind === 'approve') {
    return [
      'The user reviewed your plan and approved it (they may have edited it). Implement it now.',
      plan,
      msg && `## Note from the user\n${msg}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  if (kind === 'revise') {
    return [
      'Revise your plan based on this feedback. Do not modify any files yet.',
      `## Feedback\n${msg || '(no specific feedback; re-check the plan)'}`,
      plan && `Current plan:\n${plan}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  if (kind === 'continue') {
    return [
      msg || 'Continue working on this task from where you left off.',
      plan && `Current plan status:\n${plan}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const mode = modeFor('start', resolveConfig(task, project))
  const instructions =
    mode === 'plan'
      ? 'Investigate what is needed and propose an implementation plan. Do not modify any files. Put the ordered steps in `planSteps`.'
      : 'Complete this task. Work through the plan in order, skipping steps the user owns.'
  return [
    `# Task: ${task.title}`,
    plan,
    task.resumeNote.trim() && `## Where things stand\n${task.resumeNote.trim()}`,
    referencesSection(contextReferences(task, project)),
    task.shareNotesWithClaude && task.notes.trim() && `## The user's notes\n${task.notes.trim()}`,
    msg && `## Extra instructions\n${msg}`,
    `## What to do\n${instructions}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Standing instructions added to Claude's system prompt for every run. */
export function buildSystemAppend(project: Project | null | undefined): string {
  return [
    "You are working on a task handed over from the user's Daily Focus task app.",
    'When you finish, return the structured output: a short `summary` of what you did, and `nextStep` - the single next thing to do when the task is resumed (empty if the task is fully done).',
    project?.rules.trim() && `Project rules:\n${project.rules.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildRunRequest(
  task: Task,
  project: Project | null | undefined,
  kind: RunKind,
  message: string,
  fork = false,
): RunRequest {
  const config = resolveConfig(task, project)
  return {
    prompt: buildPrompt(task, project, kind, message),
    mode: modeFor(kind, config),
    config,
    title: task.title,
    addDirs: contextReferences(task, project)
      .filter((r) => r.kind === 'path')
      .map((r) => r.value),
    appendSystemPrompt: buildSystemAppend(project),
    resume: kind !== 'start',
    fork,
  }
}

/** Prompt for continuing a task in a fresh VS Code chat (kept short: it travels in a URL). */
export function buildHandoffPrompt(
  task: Task,
  project: Project | null | undefined,
  agent: AgentState | undefined,
): string {
  const last = agent?.runs.find((r) => !r.isError && !r.fromTerminal)
  const refs = contextReferences(task, project).filter((r) => r.kind !== 'snippet')
  return [
    `I'm continuing the task "${task.title}" here. Claude already worked on it from my task app.`,
    last?.resultText && `Last summary: ${last.resultText.slice(0, 600)}`,
    task.resumeNote.trim() && `Where things stand: ${task.resumeNote.trim().slice(0, 400)}`,
    planSection(task).slice(0, 1500),
    refs.length > 0 && `References:\n${refs.map((r) => `- ${r.label ? `${r.label}: ` : ''}${r.value}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
