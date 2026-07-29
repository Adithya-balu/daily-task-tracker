import type { Priority } from '../lib/types'

export const PRIORITY_STYLES: Record<Priority, { dot: string; chip: string; ring: string }> = {
  high: {
    dot: 'bg-rose-400',
    chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    ring: 'ring-rose-500/40',
  },
  medium: {
    dot: 'bg-amber-400',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    ring: 'ring-amber-500/40',
  },
  low: {
    dot: 'bg-sky-400',
    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    ring: 'ring-sky-500/40',
  },
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const s = PRIORITY_STYLES[priority]
  const label = priority.charAt(0).toUpperCase() + priority.slice(1)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  )
}
