# Agent workflow engine — design

## Context
Daily Focus already runs Claude Code on a task, either headless (`claude -p`, in `server/agents.ts` `AgentHub.startRun`) or interactively in Terminal or VS Code. You want each task to be able to go through a configurable sequence of agents (coder, then CI, then reviewer, then later QA). The **app** owns control: a workflow engine starts each stage in a fresh session, reads a structured verdict, and picks the next stage. Human gates sit between key steps. This document is the approved design; Phase 1 is implemented on `feature/agent-workflow`.

Decisions: **JSON** config files, **vitest** for tests, the **CI command comes from a new Project setting**, and Phase 1 works on a **task branch** created in the project folder.

---

## 1. What exists today (exploration summary)
- **Server**: a Vite plugin (`server/plugin.ts`) mounts `/api`. `Store` (`server/store.ts`) holds JSON files in `data/` with atomic writes. Files the client owns (`tasks`, `projects`, …) are saved wholesale with revision checks. The server owns `agent.json` (one `AgentState` per task) and `pendingEffects.json`.
- **Runs**: `AgentHub.startRun` spawns `claude -p --output-format stream-json --json-schema …` and streams lines to `data/runs/<task>/<run>.jsonl`. On finish it reads `result.structured_output`, usage and `total_cost_usd`, then builds a `RunSummary`. It also emits **Effects** (log entry, resume note, plan steps, daily stats). The browser applies effects to the data it owns and acks them on its next save.
- **Live updates**: SSE `/api/events` carries `{type:'agent'|'effect'}`, and `useAgent` (`src/hooks/useAgent.ts`) consumes it. Each run's log is replayed via `/api/tasks/:id/runs/:runId/events` and displayed by `RunLog`.
- **Prompts**: built **client-side** (`src/lib/claude.ts` `buildRunRequest`) from the task, project rules, references and resolved config (app ← project ← task).
- **UI**: the `TaskWorkspace` drawer has tabs Plan, Notes, References, Claude and Activity. `NeedsYouStrip` sits above the board.
- **Gaps**: there are no tests or test runner, no YAML parser, no task "type", and no CI-command concept.


## 2. Data model
New shared types go in `src/lib/workflowTypes.ts`, with no DOM or Node imports. It is added to the `tsconfig.node.json` include list, the same way as `agentTypes.ts`.

**Client-owned additions** (all optional, so existing tasks are unchanged):
- `Task.workflowId?: string`: the workflow chosen for the task.
- `Project.ciCommand?: string`: the test and lint command for the `ci` stage.

**Server-owned** `data/workflowRuns.json`: `Record<taskId, WorkflowRun[]>`, newest first, keeping the last 10 runs per task.
```ts
WorkflowRun = {
  id, taskId,
  workflow: { name, version },          // recorded per run
  definition: WorkflowDef, agents: Record<string, AgentDef>,  // snapshot at start
  status: 'running'|'awaiting_gate'|'escalated'|'interrupted'|'completed'|'cancelled',
  currentStage: string | null,
  loops: number, loopBudget: number,    // budget grows when you resume after an escalation
  cwd, branch, baseRef,                 // git context
  handoff: Handoff,
  stages: StageRecord[],
  escalation: { reason: 'max_loops'|'invalid_output'|'stage_error'|'config', summary: LoopSummary[] } | null,
  totals: { costUsd, tokens },
  startedAt, endedAt
}
StageRecord = {
  id, stage, type: 'agent'|'command'|'gate', loopIndex, attempt,
  status: 'running'|'waiting'|'succeeded'|'failed',
  outcome: string | null,               // done / pass / fail / approved / changes_requested / rejected
  summary, issues: Issue[], normalized?: boolean,
  startedAt, endedAt, durationMs, usage, costUsd,
  runId, sessionId,                     // the runId links to the existing run-log viewer
  diffFile?, commandOutput?, comment?, error?
}
Handoff = {
  ticket: { title, notes?, references, plan, projectRules, ciCommand, config },  // sent by the client at start
  plan: { text, steps } | null, planApproved: boolean,
  summaries: { stage, loopIndex, summary }[],
  feedback: { id, source: 'reviewer'|'ci'|'human', stage, text, issues?, consumed: boolean }[]
}
Issue = { severity: 'blocker'|'major'|'minor', file?, line?, description }
```
The server can't read task data mid-run without depending on the client's file. Instead, the client sends a **ticket snapshot** at start (the same pattern as `RunRequest`). The handoff record is the only context passed between stages.

## 3. Config format and validation
The files are app configuration, versioned with this repo:
```
workflows/standard-dev.json       # workflow definitions (*.json)
workflows/agents/coder.json       # agent definition
workflows/agents/coder.md         # role prompt
workflows/agents/reviewer.json / reviewer.md
```
Workflow: your example in JSON, plus an optional `"start"` (defaults to the first stage). The `ci` stage uses `"run": "{{project.ciCommand}}"`. `done` is the reserved terminal target.

Agent definition:
```json
{ "agent": "reviewer", "prompt": "reviewer.md",
  "modes": { "default": {
      "permissionMode": "default",
      "allowedTools": ["Read","Grep","Glob","Bash(git diff:*)","Bash(git log:*)","Bash(git show:*)"],
      "disallowedTools": ["Edit","Write","NotebookEdit"],
      "outputSchema": { …JSON schema… },
      "outcomes": ["approved","changes_requested"] } },
  "knowledge": [] }
```
- The `knowledge` field is accepted and ignored until Phase 3.
- **Coder**: `plan` mode runs with `permissionMode: plan` and outputs `{verdict:'done', summary, plan, planSteps}`. `implement` mode runs with `acceptEdits` plus Bash for build and test, and outputs `{verdict:'done', summary, filesChanged}`. It is told not to commit.
- **Reviewer**: outputs `{verdict, summary, issues[]}`. The engine applies the severity rule: the outcome is `changes_requested` exactly when there is at least one blocker or major issue. If the agent's verdict disagrees, the engine overrides it and marks the record `normalized: true`.

`server/workflow/config.ts` exports `loadWorkflows(dir)` and a pure `validateWorkflow(def, agents)`. Validation returns path-style errors such as `stages.ci.next.fail: unknown stage "implment"`. It checks:
1. Unknown stage targets, unknown agents and unknown modes.
2. Unreachable stages, using BFS from `start`.
3. Missing transitions. Every outcome must be mapped: agent outcomes from the agent's `outcomes`, `pass`/`fail` for commands, `approved`/`rejected` for gates. Unknown outcome keys are also errors.
4. Loops with no exit: every stage must be able to reach `done`, checked by reverse BFS.
5. Shape and limits: positive `max_loops`, `max_cost_usd` and `timeout_minutes`, plus a `version` integer.

Invalid workflows are listed in the UI with their errors and can't be started.

## 4. Engine architecture
`server/workflow/engine.ts` contains `WorkflowEngine`. It has no UI or Vite imports, and all side effects go through injected **ports**, so it can be unit-tested with fakes:
```ts
type Ports = {
  runAgent(req: AgentStageRequest): Promise<AgentStageResult>   // fresh session; resumeSessionId for the output retry
  runCommand(cmd: string, cwd: string): Promise<{ exitCode: number; output: string }>
  git: { prepareBranch(cwd, name): Promise<{ baseRef }>; commitAll(cwd, msg): Promise<void>; diff(cwd, baseRef): Promise<{ stat; patch }> }
  saveRuns(runs): void; emit(e: WorkflowEvent): void; emitEffect(e): void; writeDiff(taskId, recordId, patch): string
  now(): number
}
```
**Step loop** (`advance(run)`): run the current stage → get an outcome → `next[outcome]` → loop check → persist → repeat. The loop pauses at a gate (`awaiting_gate`), at `done` (`completed`), or on escalation.
- **Agent stage**:
  1. Build the prompt with `server/workflow/prompts.ts`: role markdown + ticket + approved plan + branch/base + diff stat + earlier summaries + unconsumed feedback.
  2. Run it, then validate `structured_output` against the schema with `server/workflow/verdict.ts`. This is a small hand-rolled validator for the subset the schemas use (object, string, array, enum, required); no ajv.
  3. If the output is missing or invalid, **retry once** by resuming the same session with the validation errors. If it fails again, the stage fails, the run escalates with `invalid_output`, and you get a notification.
  4. After `implement`, the engine commits on the task branch (`daily-focus: implement (loop n)`) and stores the diff file.
  5. Feedback the stage received is marked consumed.
- **Command stage**: substitutes `{{project.ciCommand}}`, runs `/bin/sh -c` in the run's cwd with a 15-minute safety timeout, and maps exit 0 to `pass`, anything else to `fail`. On failure, the last 8KB of output is added to the feedback.
- **Gate stage**: the record is `waiting` and the run is `awaiting_gate`. `decideGate(taskId, 'approved'|'rejected', comment)` resumes the run. A rejection comment becomes `human` feedback. Approving `plan_approval` sets `planApproved` and emits the existing `plan` effect, so the Plan tab fills.
- **Loops**: any transition to a stage already entered in this run counts as one loop. If it would exceed `loopBudget` (initially `max_loops`), the run escalates with `max_loops` and a `LoopSummary[]`: for each loop, its stages, outcomes, summaries and issues.
- **Transitions** come only from the outcome. A run error (process crash, non-success result) fails the stage and escalates with `stage_error`.
- **Resume or retry**: `retryFrom(taskId, stage)` is allowed when the run is escalated or interrupted. Resuming after `max_loops` adds another `max_loops` to `loopBudget`. `cancel(taskId)` stops the active process.
- **Restart recovery**: on load, runs left `running` become `interrupted`, so you can resume from the current stage.
- **Concurrency**: one active run per task and one active run per cwd (a folder lock). `AgentHub.startRun` refuses manual runs while the task has an active workflow (409), so existing behaviour is untouched for tasks without one.
- **Budget safety net**: each agent stage passes the remaining `max_cost_usd` as `--max-budget-usd`. Cost and timeout escalation remain Phase 2.

## 5. How sessions run
- `AgentHub` is refactored to extract argument building and spawning into a shared helper. `startRun` behaves exactly as before.
- A new `AgentHub.runHeadless(taskId, opts): Promise<HeadlessResult>` uses the same spawn path, log file and `active` map, so `/runs/:runId/events` and `RunLog` work for stage logs. It does **not** touch the task's interactive `AgentState` session.
- Each stage gets a fresh `--session-id`, runs headless, uses `--json-schema` from the agent mode, applies `--permission-mode`, `--allowedTools` and `--disallowedTools` from the agent config, and takes model and effort from the resolved task config.
- **Secrets**: workflow sessions and commands get a scrubbed env (`server/workflow/env.ts`). It drops variables matching `SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|AWS_|AZURE_|GCP_|…`, except the variables Claude itself needs to authenticate. Agents also deny `Read(**/.env*)`. Existing manual runs keep the full env.
- **Git (Phase 1)**: on start, the engine requires a git repo with a clean working tree, records `baseRef = HEAD`, and runs `git checkout -b daily-focus/<slug>-<id6>`. Diffs are `baseRef..HEAD`. Nothing is merged or pushed; at the end the UI tells you the branch is ready.

## 6. API and live events
Routes, all under `server/plugin.ts`, following the existing style:
- `GET /api/workflows`: name, version, valid, errors.
- `POST /api/tasks/:id/workflow/start` with `{workflowId, ticket}`.
- `POST …/workflow/gate` with `{decision, comment}`.
- `POST …/workflow/retry` with `{stage}`.
- `POST …/workflow/cancel`.
- `GET …/workflow/diff/:recordId`.

`GET /api/state` and `/api/live` gain `workflowRuns`, and SSE gains `{type:'workflow', taskId, run}`. Deleting a task (`forget`) also cancels the task's runs and deletes their data.

## 7. UI changes
- `useAgent` is extended (no parallel hook) with `workflowRuns` state and `startWorkflow`, `decideGate`, `retryFrom` and `cancelWorkflow`. It sends a notification and chime when a run hits a gate or escalates.
- New **Workflow** tab in `TaskWorkspace`, with these parts:
  - **Before a run**: a picker of valid workflows and a Start button. A warning appears if the project has no CI command or no working folder.
  - **Gate card**: shows the plan (markdown) for `plan_approval`, or the diff for `merge_approval`, with Approve and Reject-with-comment buttons.
  - **Escalation card**: a per-loop summary, "Resume from [stage]", and Cancel.
  - **Timeline** (`WorkflowTimeline.tsx`): one row per StageRecord with stage name, verdict chip, summary, issues colored by severity, duration, cost, "View log" (reusing `RunLog`) and "View diff".
- `NeedsYouStrip` also lists tasks with a workflow in `awaiting_gate`, `escalated` or `interrupted`, and running workflows.
- `ProjectsDialog`: a new "Test & lint command" field.
- Stage completions emit the existing `log` and `stats` effects, so Activity and the daily totals keep working.

## 8. Phased plan
- **Phase 1 (now)**: everything above. Coder plan → gate → implement → CI → review, looping on CI failure or review rejection, ending at `merge_approval`, with loop limits, the timeline UI and tests.
- **Phase 2**: QA agent with environment setup; per-task git worktrees (replacing the in-place checkout); cost and timeout escalation.
- **Phase 3**: knowledge base outside the repo (shared, agent, module and lesson layers; pending lessons approved in the app; commit-hash staleness checks).
- **Phase 4**: metrics, notifications, comparing workflow versions, and parallel split reviewers.

## 9. Risks and open questions
- **Phase 1 checks out a branch in your real project folder.** The engine refuses on a dirty tree and locks the folder, but while a run is active you shouldn't edit that folder. Phase 2 worktrees remove this.
- A dev-server restart (Vite) kills active stages. They become `interrupted` and can be resumed, but they are not continued automatically.
- Scrubbing secrets from the env is a heuristic, not isolation. Real isolation would need a container or sandbox.
- The CLI may end without `structured_output` (max turns, budget cap). That is handled by the retry and escalation path.
- The reviewer's override of its own verdict by severity is a policy choice; it is visible in the UI as "normalized".
- Gate rejections count toward `max_loops`. Open question: should they?

