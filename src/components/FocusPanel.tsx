import type { Task } from '../lib/types'
import type { UsePomodoro } from '../hooks/usePomodoro'
import { formatDuration, formatTime } from '../lib/time'
import { PomodoroTimer } from './PomodoroTimer'
import { NotesEditor } from './NotesEditor'
import { PriorityChip } from './ui'

type Props = {
  task: Task
  pomo: UsePomodoro
  onPauseRequest: () => void
  onComplete: (id: string) => void
  onClearFocus: () => void
  onTitleChange: (id: string, title: string) => void
  onResumeNoteChange: (id: string, text: string) => void
  onNotesChange: (id: string, text: string) => void
}

export function FocusPanel({
  task,
  pomo,
  onPauseRequest,
  onComplete,
  onClearFocus,
  onTitleChange,
  onResumeNoteChange,
  onNotesChange,
}: Props) {
  return (
    <section className="rounded-3xl border border-indigo-500/20 bg-gradient-to-b from-indigo-500/10 to-white/[0.02] p-6 shadow-xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-indigo-300">
            Now focusing
          </div>
          <input
            value={task.title}
            onChange={(e) => onTitleChange(task.id, e.target.value)}
            onBlur={(e) => {
              const next = e.target.value.trim() || 'Untitled'
              if (next !== task.title) onTitleChange(task.id, next)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="w-full truncate rounded-lg bg-transparent text-2xl font-bold text-white outline-none ring-indigo-400/40 focus:ring-2"
            aria-label="Task title"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <PriorityChip priority={task.priority} />
            <span>{task.pomodorosCompleted} pomodoros</span>
            <span>&middot;</span>
            <span>{formatDuration(task.focusedSeconds)} focused</span>
          </div>
        </div>
        <button
          onClick={onClearFocus}
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:text-slate-300"
          title="Stop focusing on this task"
        >
          Exit focus
        </button>
      </div>

      <div className="grid gap-8 md:grid-cols-[auto_1fr] md:items-start">
        <PomodoroTimer
          phase={pomo.phase}
          isRunning={pomo.isRunning}
          remaining={pomo.remaining}
          total={pomo.total}
          onStartResume={() => {
            // Only start a fresh focus session from a full work phase.
            // Break (and partial work) must resume the current phase — calling
            // start() here was resetting break back to a new work timer.
            if (pomo.phase === 'work' && pomo.remaining >= pomo.total) {
              pomo.start(task.id)
            } else {
              pomo.resume()
            }
          }}
          onPause={onPauseRequest}
          onSkip={() => pomo.goToPhase(pomo.phase === 'work' ? 'break' : 'work', false)}
        />

        <div className="flex min-w-0 flex-col gap-5">
          {/* Details / implementation plan for the task. */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Notes &amp; plan
            </div>
            <NotesEditor
              key={task.id}
              value={task.notes}
              onChange={(v) => onNotesChange(task.id, v)}
              rows={4}
            />
          </div>

          {/* Resume-here note: the first thing you see when coming back. */}
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-300">
              Resume here
            </div>
            <textarea
              value={task.resumeNote}
              onChange={(e) => onResumeNoteChange(task.id, e.target.value)}
              rows={3}
              placeholder="Where do you pick up next? This is the first thing you'll see when you return."
              className="w-full resize-none rounded-lg bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
            />
          </div>

          {/* Session log history. */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Session log
            </div>
            {task.sessionLog.length === 0 ? (
              <p className="text-sm text-slate-500">
                Notes you jot when pausing will show up here, so you always have a trail of what
                you did.
              </p>
            ) : (
              <ul className="flex max-h-52 flex-col gap-2 overflow-y-auto pr-1">
                {[...task.sessionLog].reverse().map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="flex gap-3 text-sm">
                    <span className="shrink-0 pt-0.5 font-mono text-xs text-slate-500">
                      {formatTime(entry.at)}
                    </span>
                    <span className="text-slate-200">{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={() => onComplete(task.id)}
            className="self-start rounded-xl bg-emerald-500/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-95"
          >
            Mark complete
          </button>
        </div>
      </div>
    </section>
  )
}
