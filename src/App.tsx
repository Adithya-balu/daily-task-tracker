import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTasks } from './hooks/useTasks'
import { usePomodoro } from './hooks/usePomodoro'
import type { TaskStatus } from './lib/types'
import { AddTaskBar } from './components/AddTaskBar'
import { Board } from './components/Board'
import { FocusPanel } from './components/FocusPanel'
import { PauseNotePrompt } from './components/PauseNotePrompt'
import { BrainDumpInbox } from './components/BrainDumpInbox'
import { SettingsDialog } from './components/SettingsDialog'
import { TaskDetail } from './components/TaskDetail'
import { HistoryPanel } from './components/HistoryPanel'
import { ensureNotificationPermission, playChime, sendNotification } from './lib/notify'
import { formatDuration, formatTodayHeading } from './lib/time'

type View = 'today' | 'history'

export default function App() {
  const store = useTasks()
  const [view, setView] = useState<View>('today')
  const [pausePromptTaskId, setPausePromptTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

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
      store.deleteTask(id)
    },
    [pomo.activeTaskId, pomo.stop, store.deleteTask],
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
      if (pausePromptTaskId || settingsOpen || detailTaskId) return

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
  }, [pomo, handlePauseRequest, pausePromptTaskId, settingsOpen, detailTaskId])

  const promptTask = pausePromptTaskId
    ? store.tasks.find((t) => t.id === pausePromptTaskId)
    : null

  const detailTask = detailTaskId ? store.tasks.find((t) => t.id === detailTaskId) : null

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Daily Focus</h1>
          <p className="mt-1 text-sm text-slate-400">
            {formatTodayHeading(store.today)}
            <span className="text-slate-600"> &middot; </span>
            One task at a time
          </p>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-xl border border-white/10 p-2 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          title="Timer settings"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* Today / History */}
      <div className="mb-6 flex items-center gap-1">
        <ViewTab active={view === 'today'} onClick={() => setView('today')}>
          Today
          {stats.doneToday > 0 && (
            <span className="ml-1.5 text-slate-500">({stats.doneToday} done)</span>
          )}
        </ViewTab>
        <ViewTab active={view === 'history'} onClick={() => setView('history')}>
          History
          {historyCount > 0 && (
            <span className="ml-1.5 text-slate-500">({historyCount})</span>
          )}
        </ViewTab>
      </div>

      {view === 'today' ? (
        <>
          {/* Stat strip */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Stat label="To do" value={String(stats.remaining)} />
            <Stat label="Pomodoros today" value={String(stats.pomodoros)} />
            <Stat label="Focused today" value={formatDuration(stats.focused)} />
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
              />
            </div>
          )}

          <div className="mb-4">
            <AddTaskBar ref={addInputRef} onAdd={store.addTask} />
          </div>

          <Board
            tasks={todayTasks}
            activeTaskId={pomo.activeTaskId}
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
      ) : (
        <HistoryPanel
          tasks={store.tasks}
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
        <TaskDetail
          task={detailTask}
          isActive={detailTask.id === pomo.activeTaskId}
          onClose={() => setDetailTaskId(null)}
          onTitleChange={store.setTitle}
          onNotesChange={store.setNotes}
          onResumeNoteChange={store.setResumeNote}
          onFocus={handleFocus}
          onComplete={handleComplete}
          onDelete={handleDelete}
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
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function ViewTab({
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
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

