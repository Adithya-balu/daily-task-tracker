import type { SessionLogEntry, SessionLogKind } from '../lib/types'
import { dayKeyOf, formatDayLabel, formatTime } from '../lib/time'

const KIND_STYLE: Record<SessionLogKind, { label: string; dot: string; text: string }> = {
  note: { label: 'You', dot: 'bg-slate-400', text: 'text-slate-200' },
  claude: { label: 'Claude', dot: 'bg-violet-400', text: 'text-slate-200' },
  terminal: { label: 'Terminal', dot: 'bg-sky-400', text: 'text-slate-300' },
}

/** Your pause notes, Claude runs and terminal sessions, newest first. */
export function ActivityTimeline({
  entries,
  onOpenRun,
}: {
  entries: SessionLogEntry[]
  onOpenRun?: (runId: string) => void
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Notes you jot when pausing a timer, and summaries of Claude's runs, collect here.
      </p>
    )
  }
  const today = dayKeyOf()
  return (
    <ul className="flex flex-col gap-3">
      {[...entries].reverse().map((entry, i) => {
        const style = KIND_STYLE[entry.kind ?? 'note']
        const day = dayKeyOf(new Date(entry.at))
        return (
          <li key={`${entry.at}-${i}`} className="flex gap-3 text-sm">
            <span className="mt-1.5 flex shrink-0 flex-col items-center">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-400">{style.label}</span>
                <span className="font-mono">
                  {day === today ? '' : `${formatDayLabel(day)} · `}
                  {formatTime(entry.at)}
                </span>
                {entry.runId && onOpenRun && (
                  <button
                    type="button"
                    onClick={() => onOpenRun(entry.runId!)}
                    className="text-violet-300 hover:text-violet-200"
                  >
                    View log
                  </button>
                )}
              </div>
              <div className={`whitespace-pre-wrap ${style.text}`}>{entry.text}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
