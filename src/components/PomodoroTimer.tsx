import type { Phase } from '../hooks/usePomodoro'
import { formatClock } from '../lib/time'

type Props = {
  phase: Phase
  isRunning: boolean
  remaining: number
  total: number
  onStartResume: () => void
  onPause: () => void
  onSkip: () => void
}

export function PomodoroTimer({
  phase,
  isRunning,
  remaining,
  total,
  onStartResume,
  onPause,
  onSkip,
}: Props) {
  const radius = 88
  const circumference = 2 * Math.PI * radius
  const progress = total > 0 ? 1 - remaining / total : 0
  const dash = circumference * progress
  const isWork = phase === 'work'
  const stroke = isWork ? '#818cf8' : '#34d399'

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-56 w-56">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 200 200">
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="var(--timer-track)"
            strokeWidth="10"
          />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - dash}
            style={{ transition: isRunning ? 'stroke-dashoffset 1s linear' : 'none' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`text-xs font-semibold uppercase tracking-widest ${
              isWork ? 'text-indigo-300' : 'text-emerald-300'
            }`}
          >
            {isWork ? 'Focus' : 'Break'}
          </span>
          <span className="mt-1 font-mono text-5xl font-bold tabular-nums text-white">
            {formatClock(remaining)}
          </span>
          <span className="mt-1 text-xs text-slate-500">
            {isRunning ? 'in progress' : 'paused'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isRunning ? (
          <button
            onClick={onPause}
            className="flex items-center gap-2 rounded-xl bg-white/10 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15 active:scale-95"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={onStartResume}
            className="flex items-center gap-2 rounded-xl bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-95"
          >
            {remaining < total ? 'Resume' : 'Start'}
          </button>
        )}
        <button
          onClick={onSkip}
          className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 active:scale-95"
        >
          {isWork ? 'Skip to break' : 'Back to focus'}
        </button>
      </div>
    </div>
  )
}
