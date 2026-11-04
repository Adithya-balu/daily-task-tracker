import type { AgentMap, AgentStatus } from '../lib/agentTypes'
import type { Task } from '../lib/types'
import { AgentBadge } from './ui'

const SHOWN: AgentStatus[] = ['awaiting_review', 'done', 'failed', 'interrupted', 'running', 'in_terminal']
// Things waiting on you come before things that are just busy.
const ORDER: Partial<Record<AgentStatus, number>> = {
  awaiting_review: 0,
  failed: 1,
  interrupted: 2,
  done: 3,
  in_terminal: 4,
  running: 5,
}

/** Claude work that needs your attention, plus what's currently running. */
export function NeedsYouStrip({
  tasks,
  agents,
  onOpen,
}: {
  tasks: Task[]
  agents: AgentMap
  onOpen: (id: string) => void
}) {
  const items = tasks
    .filter((t) => SHOWN.includes(agents[t.id]?.status ?? 'idle'))
    .sort((a, b) => (ORDER[agents[a.id].status] ?? 9) - (ORDER[agents[b.id].status] ?? 9))
  if (items.length === 0) return null

  const waiting = items.filter((t) => {
    const s = agents[t.id].status
    return s !== 'running' && s !== 'in_terminal'
  }).length

  return (
    <div className="mb-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-3">
      <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-violet-300">
        {waiting > 0 ? `Needs you (${waiting})` : 'Claude at work'}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-sm text-slate-200 transition hover:border-white/20"
          >
            <AgentBadge status={agents[t.id].status} openedIn={agents[t.id].openedIn} />
            <span className="truncate">{t.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
