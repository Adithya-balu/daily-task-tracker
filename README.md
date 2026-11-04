# Daily Focus

A local, single-page task manager built to fight context-switching. It surfaces **one task at a time**, gives each task a **built-in Pomodoro timer**, and captures a **"what I did / what's next" note every time you pause** so you can drop a task and pick it back up without the mental ramp-up.

Everything is stored in your browser's `localStorage` - no accounts, no server, works offline.

## Why it exists

When you're constantly interrupted, tasks pile up and every return to a task costs you minutes of "where was I?". Daily Focus solves that with:

- A **Resume here** note shown at the top of the active task - the first thing you see when you come back.
- A timestamped **session log** so you have a trail of what you accomplished.
- A hard rule that **only one timer runs at a time**, so you actually focus.

## Features

- **Quick add** tasks with a priority (High / Medium / Low), shown as color-coded chips; arrange them in any order via drag-and-drop.
- **Per-task Pomodoro** (default 25 min focus / 5 min break, configurable in settings).
- **Pause = capture**: pausing prompts you for "what did you just do?" (logged) and "next step when you return?" (pinned).
- **Focus panel** with a circular timer, resume note, session log, and per-task stats (pomodoros + focused time).
- **Notion-style board**: drag task cards across **To do -> In progress -> Done** columns to change status (drop on Done to complete, which also stops the timer if it was running).
- **Drag-to-reorder within a column**: an insertion line shows exactly where a card will land, so you can arrange tasks in whatever order you like. Your manual order is saved and persists.
- **Task workspace**: click any card to open a side drawer with tabs for **Plan** (ordered steps, each owned by you or Claude), **Notes** (private scratchpad), **References** (links, local files, pasted snippets), **Claude**, and **Activity** (your pause notes, Claude runs and terminal sessions in one timeline). "Resume here" stays pinned on every tab.
- **Projects**: group tasks under a project that holds the working folder, Claude defaults, rules and shared references. Filter the board by project.
- **Claude Code integration**: hand a task to Claude Code (see below).
- **Checklists inside notes**: use markdown task syntax (`- [ ] item` / `- [x] item`), or hit the "Checklist item" button. In Preview mode the boxes are interactive - tick them off and the notes text updates automatically.
- **Plan view (time blocking)**: the sidebar groups views into **Tasks** (Today, History) and **Today's plan** (Plan). Plan is an Apple Calendar-style day timeline. Drag on empty time to block it (snaps to 15 min), double-click for a one-hour block, drag a block to move it or its bottom edge to resize, and drag open tasks from the **Unscheduled** list onto the timeline (or hit **+** to drop one into the next free hour). Overlapping blocks sit side by side, a red line tracks the current time, and the selected block's editor sets start/end, duration presets, the linked task, and a **Focus now** button that starts the Pomodoro. Page to other days to plan ahead. The Today tab shows a **Now / Next** strip from the plan.
- **Day-based Done**: unfinished work always stays on Today. The Done column shows only today's completions; older ones move to a **History** tab (grouped by day), with Restore to bring one back.
- **Brain dump inbox**: park a distracting thought without leaving your current task, then triage it into a task later.
- **Light, dark, or system appearance**: switch under **Appearance** at the bottom of the sidebar. The choice is remembered per browser; "Match system" follows your OS setting live.
- **Desktop notification + chime** when a focus session ends.
- **Keyboard shortcuts**: `n` to add a task, `space` to start/pause the active timer; on the Plan tab, `Delete` removes the selected block and `Esc` deselects it.

## Claude Code integration

Daily Focus can run [Claude Code](https://code.claude.com) on a task, using the `claude` CLI already installed on this machine in headless mode (`claude -p`). It uses the CLI's existing login, so a Pro/Max/Team subscription works without an API key. Runs draw on your plan's usage limits.

- **Per-task settings** (inherit from the project, then app defaults): model, effort, working folder, extra allowed tools, a per-run budget cap, and an optional git worktree.
- **Plan first, then approve** (default): Claude investigates in read-only plan mode and its steps fill the Plan tab. Edit them, then **Approve plan & run** to continue the same session in `acceptEdits` (or `auto`) mode.
- **Continue / Fork / Start fresh**: each task keeps its Claude session; continue it with a message, branch it, or start over.
- **Live output, Stop, and run history** with tokens (input/output/cache), an API-equivalent cost estimate, turns and duration. Totals show on cards, in History, and in the "Claude tokens today" stat.
- **Open in Terminal**: opens Terminal.app on the same session (`claude --resume`) so you can steer it interactively. The task is locked while it's open and unlocks when Claude exits there (or click **I'm back**).
- **Needs you** strip above the board for plans to approve, finished runs, and failures; desktop notifications when a run ends.

Headless runs can't ask for permission, so tools that aren't allowed by the permission mode or the "Also allow tools" setting are denied (the run history flags denials). Each run ends with a structured summary that is logged to Activity and updates "Resume here".

**Security**: the API runs code on your machine. It's served only by the Vite dev server on `127.0.0.1`, rejects non-localhost Host/Origin headers and cross-site requests, and requires an `X-Daily-Focus` header on every state-changing request.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (e.g. `http://localhost:5173/`) in your browser.

`npm run dev` (and `nohup npm run dev &`) die when you close the Cursor project — the IDE sends SIGTERM to the terminal process tree, which `nohup` does not ignore. To keep the server running:

```bash
npm run dev:detach
```

That starts Vite under launchd (not as a Cursor child). Stop it with `npm run dev:stop`.

Your data lives in `data/` (gitignored) and is served by the dev server, so the app needs `npm run dev` / `npm run dev:detach` running. The first time it loads, anything the older localStorage version saved is copied into `data/` (localStorage is left untouched as a backup).

To type-check and build (note: `vite preview` serves the UI only, without the local API):

```bash
npm run build
```

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS v4
- A small local API (Vite plugin in `server/`) storing JSON files in `data/` and running the `claude` CLI

## Project structure

```
server/
  plugin.ts                  # Vite plugin: /api routes + request guard
  store.ts                   # atomic JSON files under data/
  agents.ts                  # Claude run manager (spawn claude -p, stream, summarize)
  terminal.ts                # Open in Terminal + session usage sync
  http.ts                    # JSON / SSE helpers, localhost guard
src/
  App.tsx                    # layout, view routing, orchestration
  components/
    AddTaskBar.tsx           # quick add with priority
    Board.tsx                # drag-and-drop kanban board (To do / In progress / Done)
    HistoryPanel.tsx         # past completed tasks grouped by day
    NotesEditor.tsx          # notes with interactive markdown checklists (edit/preview)
    TaskWorkspace.tsx        # task drawer: Plan / Notes / References / Claude / Activity
    PlanEditor.tsx           # ordered plan steps with status + owner
    ReferencesPanel.tsx      # links, files, snippets (optionally sent to Claude)
    ClaudePanel.tsx          # run controls, live log, run history, settings, prompt preview
    ClaudeSettingsFields.tsx # model / effort / permissions fields with inheritance
    RunLog.tsx               # streamed run output
    ActivityTimeline.tsx     # pause notes + Claude runs + terminal sessions
    ProjectsDialog.tsx       # projects: folder, rules, Claude defaults, references
    NeedsYouStrip.tsx        # Claude work waiting on you
    FocusPanel.tsx           # active task: timer + notes + resume note + session log
    PomodoroTimer.tsx        # circular countdown + controls
    PauseNotePrompt.tsx      # "what I did / next step" capture on pause
    BrainDumpInbox.tsx       # distraction capture
    SettingsDialog.tsx       # timer durations
    ui.tsx                   # shared styling: priority chips, agent badges
  hooks/
    useTasks.ts              # state + server persistence + daily rollover + server effects
    useAgent.ts              # live Claude state over SSE + run/stop/terminal actions
    usePomodoro.ts           # single-active countdown + focus accounting
  lib/
    types.ts, agentTypes.ts  # app + shared client/server types
    claude.ts                # settings inheritance + prompt builder
    api.ts, storage.ts, time.ts, format.ts, notify.ts
```

## Notes

- Data lives in `data/` next to the app; back it up by copying that folder.
- In plan mode the CLI may use a different model than the one selected (e.g. a small model can be swapped for a stronger planner); run history shows the model that actually ran.
- Notifications require granting permission the first time you start a focus session.
