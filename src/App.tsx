import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONFLICT_MESSAGE, useTasks } from './hooks/useTasks'
import { usePomodoro } from './hooks/usePomodoro'
import { useAgent } from './hooks/useAgent'
import type { TaskStatus } from './lib/types'
import { AddTaskBar } from './components/AddTaskBar'
import { Board } from './components/Board'
import { FocusPanel } from './components/FocusPanel'
import { PauseNotePrompt } from './components/PauseNotePrompt'
import { BrainDumpInbox } from './components/BrainDumpInbox'
import { SettingsDialog } from './components/SettingsDialog'
import { TaskWorkspace } from './components/TaskWorkspace'
import { HistoryPanel } from './components/HistoryPanel'
import { ProjectsDialog } from './components/ProjectsDialog'
import { NeedsYouStrip } from './components/NeedsYouStrip'
import { DayPlanner, ScheduleStrip } from './components/DayPlanner'
import { MobileNav, Sidebar, type View } from './components/Sidebar'
import { useTheme } from './lib/theme'
import { ensureNotificationPermission, playChime, sendNotification } from './lib/notify'
import { formatDuration, formatTodayHeading } from './lib/time'
import type { InitialState } from './lib/api'
import { formatTokens } from './lib/format'

/** Board filter: a project id, tasks without a project, or everything. */
type ProjectFilter = 'all' | 'none' | string

export default function App({ initial }: { initial: InitialState }) {
  const store = useTasks(initial)
  const [view, setView] = useState<View>('today')
  const [theme, setTheme] = useTheme()
  const [pausePromptTaskId, setPausePromptTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all')
  // Day shown on the planner; defaults to today and can be paged to other days.
  const [planDay, setPlanDay] = useState(store.today)
  // When the day rolls over, a planner still showing the old "today" follows along.
  const prevToday = useRef(store.today)
  useEffect(() => {
    const prev = prevToday.current
    prevToday.current = store.today
    if (prev !== store.today) setPlanDay((d) => (d === prev ? store.today : d))
  }, [store.today])
  const addInputRef = useRef<HTMLInputElement>(null)

  const tasksRef = useRef(store.tasks)
  tasksRef.current = store.tasks
  const titleOf = useCallback((id: string) => tasksRef.current.find((t) => t.id === id)?.title, [])
  const agent = useAgent(initial.agents, initial.workflowRuns ?? {}, store.applyEffect, titleOf)

  const projectNames = useMemo(
    () => Object.fromEntries(store.projects.map((p) => [p.id, p.name])),
    [store.projects],
  )
  const projectTaskCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of store.tasks) if (t.projectId) counts[t.projectId] = (counts[t.projectId] ?? 0) + 1
    return counts
  }, [store.tasks])

  const onFlushFocused = useCallback(
    (taskId: string, seconds: number) => store.addFocusedSeconds(taskId, seconds),
    [store],
  )

  const onWorkComplete = useCallback(
    (taskId: string) => {
      store.incrementPomodoro(taskId)
      const task = store.tasks.find((t) => t.id === taskId)
      playChime()
      sendNotification('Focus session complete', task ? `Nice work on "${task.title}"` : 'Time for a break')
    },
    [store],
  )

  const onWorkPhaseEnd = useCallback((taskId: string) => {
    // Prompt for what got done + the next step so returning is frictionless.
    setPausePromptTaskId(taskId)
  }, [])

  const pomo = usePomodoro({
    settings: store.settings,
    onFlushFocused,
    onWorkComplete,
    onWorkPhaseEnd,
  })

  const activeTask = useMemo(
    () => store.tasks.find((t) => t.id === pomo.activeTaskId && t.status !== 'done') ?? null,
    [store.tasks, pomo.activeTaskId],
  )

  // Today board: all unfinished work + only today's Done. Older completions → History.
  const todayTasks = useMemo(
    () =>
      store.tasks.filter(
        (t) => t.status !== 'done' || t.dayKey === store.today,
      ),
    [store.tasks, store.today],
  )

  // A deleted project can't stay selected as the filter.
  const activeFilter: ProjectFilter =
    projectFilter === 'all' || projectFilter === 'none' || projectNames[projectFilter]
      ? projectFilter
      : 'all'
  const boardTasks = useMemo(
    () =>
      activeFilter === 'all'
        ? todayTasks
        : todayTasks.filter((t) =>
            activeFilter === 'none' ? !t.projectId : t.projectId === activeFilter,
          ),
    [todayTasks, activeFilter],
  )

  const todayBlocks = useMemo(
    () => store.timeBlocks.filter((b) => b.dayKey === store.today),
    [store.timeBlocks, store.today],
  )

  const historyCount = useMemo(
    () => store.tasks.filter((t) => t.status === 'done' && t.dayKey !== store.today).length,
    [store.tasks, store.today],
  )

  const stats = useMemo(() => {
    return {
      // Board backlog (all unfinished), not "created today".
      remaining: todayTasks.filter((t) => t.status !== 'done').length,
      // True calendar-day activity from focus sessions, not lifetime task totals.
      pomodoros: store.todayStats.pomodoros,
      focused: store.todayStats.focusedSeconds,
      doneToday: todayTasks.filter((t) => t.status === 'done').length,
      claudeTokens: store.todayStats.claudeTokens ?? 0,
      claudeRuns: store.todayStats.claudeRuns ?? 0,
    }
  }, [todayTasks, store.todayStats])

  // NOTE: the handlers below depend on individually stable members (not the
  // whole `store`/`pomo` objects, which are recreated every render) so their
  // identity stays constant across timer ticks - letting the memoized Board
  // skip re-rendering while a Pomodoro counts down.
  const handleFocus = useCallback(
    (id: string) => {
      ensureNotificationPermission()
      store.setStatus(id, 'in_progress')
      pomo.start(id)
      // The focus panel lives on Today; bring it into view when starting from the planner.
      setView('today')
    },
    [store.setStatus, pomo.start],
  )

  const handlePauseRequest = useCallback(() => {
    if (pomo.activeTaskId == null) return
    pomo.pause()
    setPausePromptTaskId(pomo.activeTaskId)
  }, [pomo])

  const handlePauseSubmit = useCallback(
    (didText: string, nextStep: string) => {
      if (pausePromptTaskId) {
        store.appendSessionLog(pausePromptTaskId, didText)
        store.setResumeNote(pausePromptTaskId, nextStep)
      }
      setPausePromptTaskId(null)
    },
    [pausePromptTaskId, store],
  )

  const handleComplete = useCallback(
    (id: string) => {
      if (pomo.activeTaskId === id) pomo.stop()
      // Drop at the top of today's Done column (history stays out of this list).
      const firstDoneToday = store.tasks.find(
        (t) => t.status === 'done' && t.dayKey === store.today && t.id !== id,
      )
      store.reorderTask(id, 'done', firstDoneToday?.id ?? null)
    },
    [pomo.activeTaskId, pomo.stop, store.tasks, store.today, store.reorderTask],
  )

  const handleRestore = useCallback(
    (id: string) => {
      store.restoreToToday(id)
      setView('today')
    },
    [store.restoreToToday],
  )

  const handleDelete = useCallback(
    (id: string) => {
      if (pomo.activeTaskId === id) pomo.stop()
      if (agent.agents[id] || agent.workflowRuns[id]) void agent.forget(id).catch(() => {})
      store.deleteTask(id)
    },
    [pomo.activeTaskId, pomo.stop, store.deleteTask, agent.agents, agent.workflowRuns, agent.forget],
  )

  const handleClearFocus = useCallback(() => pomo.stop(), [pomo])

  // Drag-and-drop across / within board columns changes status and order.
  const handleReorder = useCallback(
    (id: string, status: TaskStatus, beforeId: string | null) => {
      // Leaving the active timer task (to To do or Done) stops the clock.
      if (pomo.activeTaskId === id && status !== 'in_progress') pomo.stop()
      store.reorderTask(id, status, beforeId)
    },
    [pomo.activeTaskId, pomo.stop, store.reorderTask],
  )

  // Keyboard shortcuts: `n` new task, `space` start/pause active timer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return
      if (pausePromptTaskId || settingsOpen || projectsOpen || detailTaskId) return

      if (e.key === 'n') {
        e.preventDefault()
        addInputRef.current?.focus()
      } else if (e.key === ' ') {
        // Let space activate a focused button normally.
        if (target && target.tagName === 'BUTTON') return
        if (!pomo.activeTaskId) return
        e.preventDefault()
        if (pomo.isRunning) handlePauseRequest()
        // Fresh focus only from a full work phase; break / partial work resumes.
        else if (pomo.phase === 'work' && pomo.remaining >= pomo.total) {
          pomo.start(pomo.activeTaskId)
        } else {
          pomo.resume()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pomo, handlePauseRequest, pausePromptTaskId, settingsOpen, projectsOpen, detailTaskId])

  const promptTask = pausePromptTaskId
    ? store.tasks.find((t) => t.id === pausePromptTaskId)
    : null

  const navProps = {
    view,
    counts: { doneToday: stats.doneToday, history: historyCount, blocks: todayBlocks.length },
    dateLabel: formatTodayHeading(store.today),
    theme,
    onChange: setView,
    onThemeChange: setTheme,
    onOpenProjects: () => setProjectsOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
  }

  const detailTask = detailTaskId ? store.tasks.find((t) => t.id === detailTaskId) : null
  const detailProject = detailTask?.projectId
    ? (store.projects.find((p) => p.id === detailTask.projectId) ?? null)
    : null

  return (
    <div className="flex min-h-full">
      <Sidebar {...navProps} />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <MobileNav {...navProps} />

          <header className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-white">{PAGE_TITLE[view]}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {formatTodayHeading(store.today)}
              <span className="text-slate-600"> &middot; </span>
              {PAGE_SUBTITLE[view]}
            </p>
          </header>

      {!agent.connected && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          Lost connection to the local server. Claude status updates will resume when it’s back.
        </div>
      )}

      {Object.values(store.saveErrors).includes(CONFLICT_MESSAGE) ? (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
          Your tasks were changed in another tab or browser, so this tab stopped saving. Reload to
          get the latest (your last change here wasn't saved).
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-lg bg-rose-500/20 px-3 py-1 text-xs font-semibold hover:bg-rose-500/30"
          >
            Reload
          </button>
        </div>
      ) : (
        Object.keys(store.saveErrors).length > 0 && (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
            Couldn't save changes to the local server ({Object.values(store.saveErrors)[0]}). Keep
            this tab open; it retries on your next edit.
          </div>
        )
      )}

      {view === 'today' ? (
        <>
          {/* Stat strip */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="To do" value={String(stats.remaining)} />
            <Stat label="Pomodoros today" value={String(stats.pomodoros)} />
            <Stat label="Focused today" value={formatDuration(stats.focused)} />
            <Stat
              label={`Claude tokens today · ${stats.claudeRuns} run${stats.claudeRuns === 1 ? '' : 's'}`}
              value={formatTokens(stats.claudeTokens)}
            />
          </div>

          <div className="mb-6">
            <ScheduleStrip
              blocks={todayBlocks}
              tasks={store.tasks}
              onPlan={() => {
                setPlanDay(store.today)
                setView('plan')
              }}
              onFocus={handleFocus}
            />
          </div>

          {activeTask && (
            <div className="mb-6">
              <FocusPanel
                task={activeTask}
                pomo={pomo}
                onPauseRequest={handlePauseRequest}
                onComplete={handleComplete}
                onClearFocus={handleClearFocus}
                onTitleChange={store.setTitle}
                onResumeNoteChange={store.setResumeNote}
                onNotesChange={store.setNotes}
                onPlanChange={store.setPlan}
              />
            </div>
          )}

          <NeedsYouStrip tasks={store.tasks} agents={agent.agents} onOpen={setDetailTaskId} />

          <div className="mb-4">
            <AddTaskBar ref={addInputRef} projects={store.projects} onAdd={store.addTask} />
          </div>

          {store.projects.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1">
              <FilterChip active={activeFilter === 'all'} onClick={() => setProjectFilter('all')}>
                All
              </FilterChip>
              {store.projects.map((p) => (
                <FilterChip
                  key={p.id}
                  active={activeFilter === p.id}
                  onClick={() => setProjectFilter(p.id)}
                >
                  {p.name}
                </FilterChip>
              ))}
              <FilterChip active={activeFilter === 'none'} onClick={() => setProjectFilter('none')}>
                No project
              </FilterChip>
            </div>
          )}

          <Board
            tasks={boardTasks}
            activeTaskId={pomo.activeTaskId}
            agents={agent.agents}
            projectNames={projectNames}
            onReorder={handleReorder}
            onFocus={handleFocus}
            onDelete={handleDelete}
            onOpen={setDetailTaskId}
          />

          <div className="mt-6">
            <BrainDumpInbox
              items={store.brainDump}
              onAdd={store.addDump}
              onRemove={store.removeDump}
              onPromote={store.promoteDump}
            />
          </div>

          <footer className="mt-10 text-center text-xs text-slate-600">
            Unfinished stays on Today &middot; older Done moves to History &middot; Shortcuts:{' '}
            <kbd className="rounded bg-white/10 px-1.5">n</kbd> new task &middot;{' '}
            <kbd className="rounded bg-white/10 px-1.5">space</kbd> start / pause
          </footer>
        </>
      ) : view === 'plan' ? (
        <DayPlanner
          dayKey={planDay}
          today={store.today}
          tasks={store.tasks}
          blocks={store.timeBlocks}
          activeTaskId={pomo.activeTaskId}
          onChangeDay={setPlanDay}
          onAddBlock={store.addBlock}
          onUpdateBlock={store.updateBlock}
          onDeleteBlock={store.deleteBlock}
          onFocus={handleFocus}
          onOpenTask={setDetailTaskId}
        />
      ) : (
        <HistoryPanel
          tasks={store.tasks}
          agents={agent.agents}
          today={store.today}
          onOpen={setDetailTaskId}
          onRestore={handleRestore}
          onDelete={handleDelete}
        />
      )}

      {promptTask && (
        <PauseNotePrompt
          taskTitle={promptTask.title}
          initialResumeNote={promptTask.resumeNote}
          onSubmit={handlePauseSubmit}
          onSkip={() => setPausePromptTaskId(null)}
        />
      )}

      {detailTask && (
        <TaskWorkspace
          key={detailTask.id}
          task={detailTask}
          project={detailProject}
          projects={store.projects}
          agent={agent.agents[detailTask.id]}
          agentApi={agent}
          isActive={detailTask.id === pomo.activeTaskId}
          onClose={() => setDetailTaskId(null)}
          onTitleChange={store.setTitle}
          onNotesChange={store.setNotes}
          onResumeNoteChange={store.setResumeNote}
          onPlanChange={store.setPlan}
          onReferencesChange={store.setReferences}
          onProjectChange={store.setTaskProject}
          onClaudeConfigChange={store.setTaskClaudeConfig}
          onShareNotesChange={store.setShareNotes}
          onFocus={handleFocus}
          onComplete={handleComplete}
          onDelete={handleDelete}
        />
      )}

      {projectsOpen && (
        <ProjectsDialog
          projects={store.projects}
          taskCounts={projectTaskCounts}
          onAdd={store.addProject}
          onUpdate={store.updateProject}
          onDelete={store.deleteProject}
          onClose={() => setProjectsOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={store.settings}
          onSave={store.setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
        </div>
      </main>
    </div>
  )
}

const PAGE_TITLE: Record<View, string> = {
  today: 'Today',
  plan: "Today's plan",
  history: 'History',
}

const PAGE_SUBTITLE: Record<View, string> = {
  today: 'One task at a time',
  plan: 'Block your time, then focus on one block at a time',
  history: 'What you finished on earlier days',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`max-w-48 truncate rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200'
          : 'border-white/10 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
