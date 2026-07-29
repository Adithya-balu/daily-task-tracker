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
- **Per-task notes / plan**: click any card to open a detail view with a big notes area for details, an implementation plan, checklists, or links. The active task also has an inline notes area in the focus panel, and cards with notes show a small indicator.
- **Checklists inside notes**: use markdown task syntax (`- [ ] item` / `- [x] item`), or hit the "Checklist item" button. In Preview mode the boxes are interactive - tick them off and the notes text updates automatically.
- **Daily rollover**: unfinished tasks automatically carry to today.
- **Brain dump inbox**: park a distracting thought without leaving your current task, then triage it into a task later.
- **Desktop notification + chime** when a focus session ends.
- **Keyboard shortcuts**: `n` to add a task, `space` to start/pause the active timer.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (e.g. `http://localhost:5173/`) in your browser.

To create a production build:

```bash
npm run build
npm run preview
```

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS v4
- `localStorage` for persistence

## Project structure

```
src/
  App.tsx                    # layout, view routing, orchestration
  components/
    AddTaskBar.tsx           # quick add with priority
    Board.tsx                # drag-and-drop kanban board (To do / In progress / Done)
    NotesEditor.tsx          # notes with interactive markdown checklists (edit/preview)
    TaskDetail.tsx           # click-to-open task modal: notes/plan, resume note, log
    FocusPanel.tsx           # active task: timer + notes + resume note + session log
    PomodoroTimer.tsx        # circular countdown + controls
    PauseNotePrompt.tsx      # "what I did / next step" capture on pause
    BrainDumpInbox.tsx       # distraction capture
    SettingsDialog.tsx       # timer durations
    ui.tsx                   # shared priority styling
  hooks/
    useTasks.ts              # state + localStorage + daily rollover
    usePomodoro.ts           # single-active countdown + focus accounting
  lib/
    types.ts, storage.ts, time.ts, notify.ts
```

## Notes

- Data lives only in the browser it's opened in. Clearing site data resets everything.
- Notifications require granting permission the first time you start a focus session.
