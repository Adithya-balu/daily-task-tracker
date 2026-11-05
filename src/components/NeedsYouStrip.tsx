import type { AgentMap, AgentStatus } from '../lib/agentTypes'
import type { Task } from '../lib/types'
import type { WorkflowRunMap, WorkflowRunStatus } from '../lib/workflowTypes'
import { AgentBadge, WorkflowBadge } from './ui'

const SHOWN: AgentStatus[] = ['awaiting_review', 'done', 'failed', 'interrupted', 'running', 'in_terminal']
const SHOWN_WORKFLOW: WorkflowRunStatus[] = ['awaiting_gate', 'escalated', 'interrupted', 'running']
// Things waiting on you come before things that are just busy.
const ORDER: Partial<Record<AgentStatus, number>> = {
  awaiting_review: 0,
  failed: 1,
  interrupted: 2,
  done: 3,
  in_terminal: 4,
  running: 5,
}
const WORKFLOW_ORDER: Partial<Record<WorkflowRunStatus, number>> = {
  awaiting_gate: 0,
  escalated: 0,
  interrupted: 2,
  running: 5,
}

type Item = { task: Task; workflow: WorkflowRunStatus | null; agent: AgentStatus | null; order: number }

/** Claude work and workflow gates that need your attention, plus what's running. */
export function NeedsYouStrip({
  tasks,
  agents,
  workflowRuns,
  onOpen,
}: {
  tasks: Task[]
  agents: AgentMap
  workflowRuns: WorkflowRunMap
  onOpen: (id: string) => void
}) {
  const items: Item[] = []
  for (const task of tasks) {
    const wf = workflowRuns[task.id]?.[0]?.status
    const ag = agents[task.id]?.status ?? 'idle'
    // A workflow's state wins: it's what the task is waiting on.
    if (wf && SHOWN_WORKFLOW.includes(wf)) {
      items.push({ task, workflow: wf, agent: null, order: WORKFLOW_ORDER[wf] ?? 9 })
    } else if (SHOWN.includes(ag)) {
      items.push({ task, workflow: null, agent: ag, order: ORDER[ag] ?? 9 })
    }
  }
  if (items.length === 0) return null
  items.sort((a, b) => a.order - b.order)

  const waiting = items.filter((i) =>
    i.workflow ? i.workflow !== 'running' : i.agent !== 'running' && i.agent !== 'in_terminal',
  ).length

  return (
    <div className="mb-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-3">
      <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-violet-300">
        {waiting > 0 ? `Needs you (${waiting})` : 'Claude at work'}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(({ task: t, workflow, agent }) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-sm text-slate-200 transition hover:border-white/20"
          >
            {workflow ? (
              <WorkflowBadge status={workflow} />
            ) : (
              <AgentBadge status={agent ?? undefined} openedIn={agents[t.id]?.openedIn} />
            )}
            <span className="truncate">{t.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
