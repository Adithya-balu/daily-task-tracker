# AI section — design

An **AI** view in the sidebar where workflows and agents are created and edited in the app, instead of by hand-editing `workflows/*.json`. It extends the Phase 1 engine described in [agent-workflow-design.md](agent-workflow-design.md). The knowledge base stays in Phase 3.

Decisions (from your answers):
- Edits are saved in `data/ai/`, with the repo files as built-in defaults.
- Workflows are edited in a form editor with live validation.
- Each agent has an editable role prompt and instructions, tools and permissions, and model and effort, and you can create new agents.

## 1. Storage and versions

```
workflows/                 built-in defaults (shipped with the app, unchanged)
  standard-dev.json, bugfix.json
  agents/coder.json + coder.md, reviewer.json + reviewer.md
data/ai/                   your edits (server-owned, like workflowRuns.json)
  workflows/<id>.json
  agents/<id>.json + <id>.md
```

- **Same format in both places.** A file in `data/ai/` uses exactly the repo format, so copying it into `workflows/` makes it a built-in default.
- **Merging.** The loader reads the built-ins first, then `data/ai/`. An entry with the same id replaces the built-in. Each entry gets a `source`:
  - `builtin`: the shipped file, unchanged.
  - `modified`: your edit of a built-in. You can choose **Reset to default**.
  - `custom`: created by you. You can **Delete** it.
- **Versions.** Each save sets `version` to one more than the current version, for both workflows and agents; `version` is new on agents. Runs already snapshot the workflow and agent definitions when they start, and they now also record each agent's version. Edits only affect runs started afterwards, and resuming a run keeps using its snapshot.
- **Ids.** Ids are lowercase slugs (`^[a-z0-9][a-z0-9_-]{0,47}$`), which also rules out path traversal. An id can't be changed after creation; use **Duplicate** to make a copy with a new id. Tasks refer to workflows by id, so this keeps `Task.workflowId` valid.
- **Concurrent edits.** A save sends the version it was editing. If the stored version has moved on, for example from an edit in another tab, the save is refused with a 409 and the UI asks you to reload.

## 2. Validation

- **Shared validators.** The pure validators (`validateWorkflow`, `validateAgent`, `stageOutcomes`, …) move from `server/workflow/config.ts` to `src/lib/workflowValidate.ts`, which has no Node imports. The editor and the server then run the same checks. `config.ts` keeps only the file loading and re-exports the validators, so the engine and the tests are unchanged.
- **Live in the editor.** Errors appear next to the field they belong to; the path, e.g. `stages.ci.next.fail`, maps to the field.
- **On save.** The server validates again. **An invalid workflow or agent can't be saved**, so the config on disk is always valid.
- **New agent rules:**
  - An agent used by a workflow can't be deleted or reset away. The error lists the workflows that use it.
  - Removing a mode that a workflow stage uses is an error.
  - A workflow that refers to an invalid agent stays invalid, as it is today.

## 3. Workflow editor (form)

The Workflows tab shows a list of workflows on the left, each with badges: Built-in / Modified / Custom, Invalid, and the version. The editor is on the right:

- **Header fields:** id (read-only after creation), description, and the start stage (defaults to the first stage).
- **Limits:** `max_loops`, `max_cost_usd` and `timeout_minutes` as number fields, each with a one-line explanation.
- **Stages:** an ordered list of stage cards, with buttons to add a stage, move it up or down, and delete it. Each card has:
  - **Id.** Renaming a stage updates every transition that points to it.
  - **Type:** agent, command or gate.
  - **Settings for the type:**
    - agent: an agent picker and a mode picker filled from that agent.
    - command: the command text, with `{{project.ciCommand}}` offered as the default and explained.
    - gate: what the gate shows, the plan or the diff.
  - **Transitions:** one row per outcome the stage can produce. The outcomes come from `stageOutcomes`: an agent's verdict enum, pass/fail for commands, or approved/rejected for gates. Each row is a dropdown of stages plus **done**, so every outcome always gets a transition and the form can't produce an unknown target.
- **Flow preview:** a read-only text line showing where each outcome leads, e.g. `analysis → plan_approval → implement → ci (fail ↺ implement) → review → merge_approval → done`.
- **Actions:**
  - **Save**, disabled while there are errors or nothing has changed.
  - **Discard**, **Duplicate**, and **Reset to default** or **Delete**, depending on the source.
  - Leaving with unsaved changes asks you to confirm first.
- **New workflow:** starts blank, or as a copy of an existing workflow.

## 4. Agent editor

The Agents tab uses the same list-and-editor layout.

- **Role prompt:** a markdown text area, saved as `<id>.md`.
- **Model and effort:** optional per-agent `model` and `effort`. They're new optional fields on `AgentDef`; when one is set it overrides the task's setting for that agent, otherwise the task's setting is used. Example: a cheaper model for the reviewer.
- **Modes:** tabs for the agent's modes, such as plan and implement, with add, rename and delete. Each mode has:
  - **Instructions:** a text area. This is the per-mode prompt.
  - **Permissions:** the permission mode (plan, default or acceptEdits), plus allowed and denied tool lists as editable chips. Presets fill these in:
    - *Read-only*: Read, Grep, Glob.
    - *Read + git inspection*: the reviewer's current set.
    - *Edit code*: acceptEdits, with the coder's implement set.
  - **Output:** chosen from templates, so you don't have to write a JSON schema by hand.

    | Template | Verdicts | Extra fields |
    |---|---|---|
    | Plan | done | plan, planSteps |
    | Implement | done | filesChanged |
    | Review | approved / changes_requested | issues, plus the severity rule |
    | Check | pass / fail | issues |
    | Custom | your own list | issues optional |

    For Review and Check, the severity rule (`outcomeFromIssues`: which severities block) can be edited. An **Advanced** toggle shows the generated JSON schema so you can edit it directly; it's validated as it is today.
- **Warnings** (shown, not blocking):
  - A mode with `acceptEdits`, or with Edit or Write allowed, in an agent whose verdicts look like review verdicts.
  - `Bash` allowed without any narrowing pattern.
- **Creating an agent:** starts from a template agent:
  - *Reviewer-like*: read-only, Review output.
  - *QA-like*: read + Bash, Check output.
  - *Blank*: one mode, Custom output.

## 5. Safety rules editing can't remove

Agent tools can now be edited in the UI, so the engine adds a fixed **baseline** to every agent session in `runners.ts`, whatever the config says:
- Always denied:
  - `Read(./**/.env)` and `Read(./**/.env.*)`
  - `Bash(git push:*)`, `Bash(git merge:*)`, `Bash(git rebase:*)`, `Bash(git reset:*)`, `Bash(git checkout:*)` and `Bash(git switch:*)`

  This keeps "nothing merged automatically" true, and stops an agent switching the branch the engine created.
- The scrubbed environment, the cost limit and the folder lock are unchanged.
- The agent editor shows the baseline as locked chips, so it's clear these rules exist and can't be removed.

## 6. API

All routes go in `server/plugin.ts`, following the existing route style.
- `GET /api/ai`: every workflow and agent, with `def`, `rolePrompt` (agents), `source`, `errors`, `usedBy` (agents) and `hasDefault`.
- `PUT /api/ai/workflows/:id` with `{ def, baseVersion }`: validate, set the version, write to `data/ai/workflows/`.
- `DELETE /api/ai/workflows/:id`: delete a custom workflow, or reset a modified one to its built-in.
- `PUT /api/ai/agents/:id` with `{ def, rolePrompt, baseVersion }`, and `DELETE /api/ai/agents/:id`: the same rules, plus the in-use check.
- `GET /api/workflows`, used by the task's Workflow tab, returns the merged list. Saves broadcast an SSE `{type:'ai'}` event so open tabs refresh.

## 7. Code changes
- `src/lib/workflowTypes.ts`:
  - `AgentDef` gains optional `version`, `model`, `effort` and `description`.
  - New `AiEntrySource` and `AiConfig` response types.
  - Runs record each agent's version.
- `src/lib/workflowValidate.ts` (new): the pure validators, moved out of `config.ts`.
- `src/lib/agentTemplates.ts` (new): the output-schema templates, tool presets and starter agents. It's shared by the editor and the tests.
- `server/workflow/config.ts`: `loadWorkflowConfig(builtinDir, userDir)` merges the two folders and adds `source`. The new `saveWorkflow`, `saveAgent` and `removeEntry` functions use the store's atomic writes.
- `server/workflow/runners.ts`: the baseline denies, and the agent's model and effort taking precedence over the ticket's.
- `server/plugin.ts`: the `/api/ai` routes.
- `src/components/Sidebar.tsx`: a new `'ai'` view with the label **AI**.
- New components:
  - `src/components/ai/AiSection.tsx`: the tabs and list-and-editor layout.
  - `WorkflowEditor.tsx` and `StageCard.tsx`.
  - `AgentEditor.tsx` and `ModeEditor.tsx`.
  - `useAiConfig.ts`: loads, saves and listens for the SSE event.
- Tasks without a workflow are unaffected. Existing runs keep their snapshots.

## 8. Tests
- **Loader:** built-in only; an override replaces a built-in; a custom entry is added; reset brings the built-in back; an invalid file in `data/ai` is reported, not crashed on.
- **Save:**
  - The version goes up, and a stale `baseVersion` gets a 409.
  - An invalid definition is refused.
  - Bad ids and path traversal are refused.
  - Deleting an agent in use is refused.
- **Templates:** every template and starter agent passes `validateAgent`, and each workflow built from them passes `validateWorkflow`.
- **Runners:** the baseline denies are always added to `disallowedTools`, and the agent's model and effort override the ticket's.
- **Engine:** a run started before an edit keeps its snapshot after the edit.
- **Existing tests:** all 45 keep passing.

## 9. Commits
1. Move the validators to `src/lib/workflowValidate.ts`, with no behaviour change.
2. Storage: the merged loader, save/delete, versions and ids, with tests.
3. API routes and the SSE event; the baseline denies and agent model/effort in runners, with tests.
4. Templates and presets, with tests.
5. The UI: sidebar view, AI section, workflow editor.
6. The UI: agent editor.
7. README and doc updates.

## 10. Out of scope / open questions
- **Knowledge base:** Phase 3. The `knowledge` field stays accepted but ignored, and there's no Knowledge tab yet.
- **Graph diagram:** none; only the text flow preview.
- **History:** older versions aren't kept, so there's no undo beyond Reset to default. Runs still record their version and a snapshot of the definition, so you can always see what a past run used.
- **Decided:** **Reset to default** isn't blocked while a run of that workflow is active, because the run uses its own snapshot.

## 11. As built
- **Save logic location:** the save/reset/delete logic lives in `server/workflow/aiStore.ts` (`AiConfigStore`), not in `config.ts`. This avoids an import cycle with the engine's `WorkflowError`.
- **Checking a change:** every save and delete is checked against the whole merged config before it's written. Any workflow that was valid and would become invalid blocks the change, so a deleted agent, a removed mode, or a changed verdict list can't slip through. The agent editor runs the same check live.
- **Versions after reset:** versions never repeat after a reset. `data/ai/versions.json` keeps the highest version used for each id.
- **Snapshot copies:** runs now deep-copy their workflow and agent snapshot when they start. The new tests showed that a shallow copy shared objects with the loaded config.
- **Editor helpers:**
  - `src/lib/workflowEdit.ts` holds the form's stage operations: rename, which also updates transitions; move; remove; syncing transitions to a stage's outcomes; and the flow preview.
  - `src/lib/agentTemplates.ts` holds the output templates, which can also be read back from an existing schema, plus the presets, the starter agents, the warnings, and `fitSeverityRule`, which keeps the severity rule valid as verdicts change.
