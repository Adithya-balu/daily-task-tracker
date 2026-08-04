import { useMemo } from 'react'
import type { Task } from '../lib/types'
import { formatDayLabel, formatDuration, formatTime } from '../lib/time'
import { PriorityChip } from './ui'

type Props = {
  tasks: Task[]
  today: string
  onOpen: (id: string) => void
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

type DayGroup = {
  dayKey: string
  tasks: Task[]
  focusedSeconds: number
  pomodoros: number
}

/**
 * Past completed work, grouped by day. Today's Done stays on the board;
 * older completions land here. Unfinished tasks are never listed here.
 */
export function HistoryPanel({ tasks, today, onOpen, onRestore, onDelete }: Props) {
  const groups = useMemo(() => {
    const byDay = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.status !== 'done' || t.dayKey === today) continue
      const list = byDay.get(t.dayKey) ?? []
      list.push(t)
      byDay.set(t.dayKey, list)
    }

    const result: DayGroup[] = []
    for (const [dayKey, dayTasks] of byDay) {
      dayTasks.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      result.push({
        dayKey,
        tasks: dayTasks,
        focusedSeconds: dayTasks.reduce((n, t) => n + t.focusedSeconds, 0),
        pomodoros: dayTasks.reduce((n, t) => n + t.pomodorosCompleted, 0),
      })
    }
    result.sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1))
    return result
  }, [tasks, today])

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
        <p className="text-slate-400">No history yet.</p>
        <p className="mt-1 text-sm text-slate-600">
          Tasks you complete today stay on the board. Older completions will collect here by day.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.dayKey}>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h3 className="text-sm font-semibold text-slate-200">
              {formatDayLabel(group.dayKey)}
            </h3>
            <span className="text-xs text-slate-500">
              {group.tasks.length} done
              {group.pomodoros > 0 && <> &middot; {group.pomodoros} pomo</>}
              {group.focusedSeconds > 0 && <> &middot; {formatDuration(group.focusedSeconds)}</>}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {group.tasks.map((task) => (
              <li
                key={task.id}
                className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3"
              >
                <button
                  type="button"
                  onClick={() => onOpen(task.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-medium text-slate-300 line-through">
                    {task.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    <PriorityChip priority={task.priority} />
                    {task.completedAt != null && <span>{formatTime(task.completedAt)}</span>}
                    {task.pomodorosCompleted > 0 && (
                      <span>
                        {task.pomodorosCompleted} pomo &middot;{' '}
                        {formatDuration(task.focusedSeconds)}
                      </span>
                    )}
                    {task.notes.trim() && <span>Has notes</span>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onRestore(task.id)}
                  className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-slate-300 opacity-0 transition hover:bg-white/10 group-hover:opacity-100"
                  title="Move back to today's To do"
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(task.id)}
                  title="Delete permanently"
                  className="shrink-0 rounded-lg p-1.5 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                    <path d="M8 3h4a1 1 0 011 1v1h3v2H4V5h3V4a1 1 0 011-1zm-2 6h8l-.7 8.1a1 1 0 01-1 .9H7.7a1 1 0 01-1-.9L6 9z" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
