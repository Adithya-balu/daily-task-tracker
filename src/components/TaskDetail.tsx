import { useEffect } from 'react'
import type { Task } from '../lib/types'
import { formatDuration, formatTime } from '../lib/time'
import { NotesEditor } from './NotesEditor'
import { PriorityChip } from './ui'

type Props = {
  task: Task
  isActive: boolean
  onClose: () => void
  onTitleChange: (id: string, title: string) => void
  onNotesChange: (id: string, notes: string) => void
  onResumeNoteChange: (id: string, note: string) => void
  onFocus: (id: string) => void
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

const STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export function TaskDetail({
  task,
  isActive,
  onClose,
  onTitleChange,
  onNotesChange,
  onResumeNoteChange,
  onFocus,
  onComplete,
  onDelete,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isDone = task.status === 'done'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="animate-pop-in my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div className="min-w-0 flex-1">
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
              className="w-full rounded-lg bg-transparent text-xl font-bold text-white outline-none ring-indigo-400/40 focus:ring-2"
              aria-label="Task title"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <PriorityChip priority={task.priority} />
              <span className="rounded-full bg-white/10 px-2 py-0.5">{STATUS_LABEL[task.status]}</span>
              {task.pomodorosCompleted > 0 && (
                <span>
                  {task.pomodorosCompleted} pomo &middot; {formatDuration(task.focusedSeconds)} focused
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            title="Close (Esc)"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-5 p-5">
          {/* Notes: the main details / implementation plan area. */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Notes &amp; plan
            </div>
            <NotesEditor
              key={task.id}
              value={task.notes}
              onChange={(v) => onNotesChange(task.id, v)}
              rows={8}
            />
          </div>

          {/* Resume-here note. */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-emerald-300">
              Resume here
            </label>
            <textarea
              value={task.resumeNote}
              onChange={(e) => onResumeNoteChange(task.id, e.target.value)}
              rows={2}
              placeholder="The one thing to pick up first when you return."
              className="w-full resize-none rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400/50"
            />
          </div>

          {/* Session log. */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Session log
            </div>
            {task.sessionLog.length === 0 ? (
              <p className="text-sm text-slate-500">
                Notes you jot when pausing a timer collect here.
              </p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-3">
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
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 p-5">
          <button
            onClick={() => {
              onDelete(task.id)
              onClose()
            }}
            className="rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:text-rose-400"
          >
            Delete
          </button>
          <div className="flex items-center gap-2">
            {!isDone && (
              <button
                onClick={() => {
                  onComplete(task.id)
                  onClose()
                }}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 active:scale-95"
              >
                Mark complete
              </button>
            )}
            {!isDone && (
              <button
                onClick={() => {
                  onFocus(task.id)
                  onClose()
                }}
                className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-95"
              >
                {isActive ? 'Refocus' : 'Focus'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
