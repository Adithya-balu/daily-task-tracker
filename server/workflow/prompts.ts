import { referencesSection } from '../../src/lib/claude'
import type { AgentDef, AgentModeDef, Feedback, WorkflowRun } from '../../src/lib/workflowTypes'
import { agentOutcomes } from './config'

function feedbackLine(f: Feedback): string {
  const who = f.source === 'human' ? 'the user' : f.source === 'ci' ? 'CI' : f.source
  const issues = (f.issues ?? []).map(
    (i) => `  - [${i.severity}] ${i.file ? `${i.file}${i.line ? `:${i.line}` : ''}: ` : ''}${i.description}`,
  )
  return [`- From ${who} (after ${f.stage}):\n${indent(f.text)}`, ...issues].join('\n')
}

function indent(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
}

/** The latest diff stat recorded on the run, if any stage produced one. */
export function latestDiffStat(run: WorkflowRun): string {
  for (let i = run.stages.length - 1; i >= 0; i--) {
    if (run.stages[i].diffStat) return run.stages[i].diffStat!
  }
  return ''
}

/**
 * Builds an agent stage's prompt from the handoff record only: the ticket,
 * the plan, the branch, earlier stages' summaries and outstanding feedback.
 */
export function buildStagePrompt(
  run: WorkflowRun,
  stage: string,
  agent: AgentDef,
  modeName: string,
  feedback: Feedback[],
): string {
  const { ticket, plan, planApproved, summaries } = run.handoff
  const mode = agent.modes[modeName]
  const diffStat = latestDiffStat(run)
  const steps = ticket.plan.map((s, i) => `${i + 1}. ${s.text}${s.owner === 'me' ? ' (the user does this step)' : ''}`)
  const outcomes = agentOutcomes(agent, modeName) ?? []

  return [
    `# Ticket: ${ticket.title}`,
    steps.length > 0 && `## Steps the user listed\n${steps.join('\n')}`,
    ticket.notes.trim() && `## The user's notes\n${ticket.notes.trim()}`,
    referencesSection(ticket.references),
    plan &&
      (planApproved
        ? `## Approved plan\n${plan.text.trim()}`
        : `## Proposed plan (not approved yet)\n${plan.text.trim()}`),
    [
      '## Branch',
      `You are working on branch \`${run.branch}\`, created from commit \`${run.baseRef}\`.`,
      `See all committed changes with \`git diff ${run.baseRef}..HEAD\`.`,
      diffStat && `Changes so far:\n\`\`\`\n${diffStat.trim()}\n\`\`\``,
    ]
      .filter(Boolean)
      .join('\n'),
    summaries.length > 0 &&
      `## Earlier stages\n${summaries.map((s) => `- ${s.stage}${s.loopIndex ? ` (loop ${s.loopIndex})` : ''}: ${s.summary}`).join('\n')}`,
    feedback.length > 0 && `## Outstanding feedback (address all of it)\n${feedback.map(feedbackLine).join('\n')}`,
    `## Your job in this stage (${stage})\n${mode.instructions}`,
    `End by returning the structured output. \`verdict\` must be one of: ${outcomes.join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** System prompt: the agent's role plus standing project rules. */
export function buildStageSystemPrompt(run: WorkflowRun, stage: string, rolePrompt: string): string {
  const rules = run.handoff.ticket.projectRules.trim()
  return [
    rolePrompt.trim(),
    `You are running stage "${stage}" of the "${run.workflow.name}" workflow (v${run.workflow.version}). ` +
      'You run non-interactively: nobody can answer questions. The app and the user only see your structured output.',
    rules && `Project rules:\n${rules}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Sent to the same session when its structured output was missing or invalid. */
export function buildRetryPrompt(errors: string[], mode: AgentModeDef): string {
  return [
    'Your final structured output was missing or invalid:',
    errors.map((e) => `- ${e}`).join('\n'),
    'Do not do any more work. Return the structured output again now, matching this schema exactly:',
    '```json\n' + JSON.stringify(mode.outputSchema, null, 2) + '\n```',
  ].join('\n\n')
}
