/**
 * Types for multi-agent workflows, shared by the browser and the local API
 * server (server/workflow/). Keep this file free of DOM or Node imports.
 */
import type { TokenUsage } from './agentTypes'
import type { ClaudeEffort, ClaudeModel, PlanStep, Reference } from './types'

/** Reserved transition target that ends a workflow successfully. */
export const DONE = 'done'

// ---- config (workflows/*.json, workflows/agents/*.json) ----

export type StageType = 'agent' | 'command' | 'gate'

/** Outcome name -> next stage id (or DONE). */
export type Transitions = Record<string, string>

export type AgentStageDef = { type: 'agent'; agent: string; mode?: string; next: Transitions }
export type CommandStageDef = { type: 'command'; run: string; next: Transitions }
/** `show` picks what the gate card displays: the plan or the branch diff. */
export type GateStageDef = { type: 'gate'; show?: 'plan' | 'diff'; next: Transitions }
export type StageDef = AgentStageDef | CommandStageDef | GateStageDef

export type WorkflowLimits = {
  /** Returns to an already-visited stage allowed before escalating. */
  max_loops: number
  max_cost_usd: number
  timeout_minutes: number
}

export type WorkflowDef = {
  workflow: string
  version: number
  description?: string
  /** First stage; defaults to the first key of `stages`. */
  start?: string
  stages: Record<string, StageDef>
  limits: WorkflowLimits
}

/** The subset of JSON Schema that agent output schemas may use. */
export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: (string | number)[]
}

export type PermissionMode = 'plan' | 'default' | 'acceptEdits'

export type AgentModeDef = {
  permissionMode: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
  /** What to do in this mode; added to the stage prompt. */
  instructions: string
  /** Must have a `verdict` string enum (the outcomes) and a `summary` string. */
  outputSchema: JsonSchema
}

/**
 * Derives the outcome from reported issues instead of trusting the agent's
 * verdict, e.g. "changes_requested exactly when a blocker or major exists".
 */
export type OutcomeFromIssues = { blocking: IssueSeverity[]; blocked: string; clear: string }

export type AgentDef = {
  agent: string
  /** Raised on every save in the AI section; runs record it in their snapshot. */
  version?: number
  description?: string
  /** Role prompt markdown file, next to the agent's JSON file. */
  prompt: string
  /** Override the task's model and effort for this agent's sessions. */
  model?: ClaudeModel
  effort?: ClaudeEffort
  modes: Record<string, AgentModeDef>
  outcomeFromIssues?: OutcomeFromIssues
  /** Knowledge layers this agent receives (Phase 3; accepted and ignored for now). */
  knowledge?: string[]
}

/** What GET /api/workflows returns for each workflow file. */
export type WorkflowSummary = {
  id: string
  version: number | null
  description: string
  valid: boolean
  errors: string[]
}

// ---- AI section (GET /api/ai) ----

/**
 * builtin: shipped in workflows/, unchanged. modified: your edit of a built-in
 * (can be reset). custom: created by you (can be deleted).
 */
export type AiEntrySource = 'builtin' | 'modified' | 'custom'

export type AiWorkflowEntry = {
  id: string
  /** As stored; may be malformed if the file was hand-edited. */
  def: WorkflowDef | null
  source: AiEntrySource
  errors: string[]
}

export type AiAgentEntry = {
  id: string
  def: AgentDef | null
  rolePrompt: string
  source: AiEntrySource
  errors: string[]
  /** Workflows with a stage that uses this agent. */
  usedBy: string[]
}

export type AiConfig = { workflows: AiWorkflowEntry[]; agents: AiAgentEntry[] }

/**
 * Denied in every workflow session whatever the agent's config says: secrets
 * stay unreadable, and only you merge, push or move the task branch.
 */
export const BASELINE_DISALLOWED_TOOLS = [
  'Read(./**/.env)',
  'Read(./**/.env.*)',
  'Bash(git push:*)',
  'Bash(git merge:*)',
  'Bash(git rebase:*)',
  'Bash(git reset:*)',
  'Bash(git checkout:*)',
  'Bash(git switch:*)',
]

/** Ids of workflows and agents created in the AI section. */
export const AI_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/

// ---- runtime (data/workflowRuns.json) ----

/** Task context the browser sends when a workflow starts. */
export type Ticket = {
  title: string
  /** Only set when the task shares its notes with Claude. */
  notes: string
  references: Reference[]
  plan: PlanStep[]
  projectRules: string
  ciCommand: string
  workingDir: string
  model?: ClaudeModel
  effort?: ClaudeEffort
  /** Folders from path references that agents may read. */
  addDirs: string[]
}

export type IssueSeverity = 'blocker' | 'major' | 'minor'

export type Issue = {
  severity: IssueSeverity
  file?: string
  line?: number
  description: string
}

/** 'ci', 'human', or the name of the agent that raised it (e.g. 'reviewer'). */
export type FeedbackSource = string

export type Feedback = {
  id: string
  source: FeedbackSource
  stage: string
  text: string
  issues?: Issue[]
  /** Set once an agent stage has been given this feedback. */
  consumed: boolean
}

/** Context passed between stages. Sessions are never shared. */
export type Handoff = {
  ticket: Ticket
  plan: { text: string; steps: string[] } | null
  planApproved: boolean
  summaries: { stage: string; loopIndex: number; summary: string }[]
  feedback: Feedback[]
}

export type StageStatus = 'running' | 'waiting' | 'succeeded' | 'failed'

export type StageRecord = {
  id: string
  stage: string
  type: StageType
  /** The pass this stage ran in (0 = first). A new pass starts on every loop or resume. */
  loopIndex: number
  /** 2 when the agent was asked again for valid output. */
  attempt: number
  status: StageStatus
  outcome: string | null
  summary: string
  issues: Issue[]
  /** The engine overrode the agent's verdict using its issues' severities. */
  normalized?: boolean
  startedAt: number
  endedAt: number | null
  durationMs: number
  usage: TokenUsage
  costUsd: number
  /** Run log id, viewable through the existing run-log stream. */
  runId: string | null
  sessionId: string | null
  /** Diff of the task branch after this stage (implement stages). */
  hasDiff?: boolean
  diffStat?: string
  commandOutput?: string
  exitCode?: number
  comment?: string
  error?: string
}

export type WorkflowRunStatus =
  | 'running'
  | 'awaiting_gate'
  | 'escalated'
  | 'interrupted'
  | 'completed'
  | 'cancelled'

/** `budget`: max_cost_usd already spent (full cost/timeout budgets are Phase 2). */
export type EscalationReason = 'max_loops' | 'invalid_output' | 'stage_error' | 'budget'

export type LoopSummary = {
  loopIndex: number
  stages: { stage: string; outcome: string | null; summary: string; issues: Issue[] }[]
}

export type Escalation = { reason: EscalationReason; message: string; loops: LoopSummary[] }

export type WorkflowRun = {
  id: string
  taskId: string
  workflow: { name: string; version: number }
  /** Snapshots taken at start, so editing config files can't break a run. */
  definition: WorkflowDef
  agents: Record<string, AgentDef & { rolePrompt: string }>
  status: WorkflowRunStatus
  currentStage: string | null
  /** Returns to a stage already entered in the same pass. */
  loops: number
  /** Current pass; stage records carry it as loopIndex. */
  pass: number
  /** Loops allowed before escalating; grows by max_loops each time you resume. */
  loopBudget: number
  /** Spend allowed before escalating; grows by max_cost_usd each time you resume. */
  costBudgetUsd: number
  cwd: string
  branch: string
  baseRef: string
  handoff: Handoff
  stages: StageRecord[]
  escalation: Escalation | null
  totals: { costUsd: number; tokens: number }
  startedAt: number
  endedAt: number | null
}

/** Runs per task, newest first. */
export type WorkflowRunMap = Record<string, WorkflowRun[]>

export const ACTIVE_RUN_STATUSES: WorkflowRunStatus[] = ['running', 'awaiting_gate']
/** Statuses that wait on you. */
export const NEEDS_YOU_STATUSES: WorkflowRunStatus[] = ['awaiting_gate', 'escalated', 'interrupted']

export function latestRun(runs: WorkflowRunMap, taskId: string): WorkflowRun | undefined {
  return runs[taskId]?.[0]
}

export function isActiveRun(run: WorkflowRun | undefined): boolean {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status))
}

/** What a gate shows: its `show` setting, else the plan until one is approved. */
export function gateView(run: WorkflowRun, stage: string): 'plan' | 'diff' {
  const def = run.definition.stages[stage]
  if (def?.type === 'gate' && def.show) return def.show
  return run.handoff.plan && !run.handoff.planApproved ? 'plan' : 'diff'
}
