import type { Priority } from '../lib/types'
import type { AgentStatus } from '../lib/agentTypes'
import type { WorkflowRunStatus } from '../lib/workflowTypes'

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

export const AGENT_STATUS_STYLE: Record<AgentStatus, { label: string; chip: string } | null> = {
  idle: null,
  running: { label: 'Claude working', chip: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  awaiting_review: {
    label: 'Plan ready',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  done: { label: 'Claude done', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  failed: { label: 'Run failed', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  in_terminal: { label: 'In Terminal', chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  interrupted: {
    label: 'Interrupted',
    chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
}

/** Small pill showing a task's Claude state; renders nothing when idle. */
export function AgentBadge({
  status,
  openedIn,
}: {
  status: AgentStatus | undefined
  openedIn?: 'terminal' | 'vscode' | null
}) {
  const base = status ? AGENT_STATUS_STYLE[status] : null
  if (!base) return null
  const s = status === 'in_terminal' && openedIn === 'vscode' ? { ...base, label: 'In VS Code' } : base
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.chip}`}
    >
      {status === 'running' ? (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-300/30 border-t-violet-300" />
      ) : status === 'in_terminal' ? (
        <span className="font-mono text-[10px]">&gt;_</span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {s.label}
    </span>
  )
}

export const WORKFLOW_STATUS_STYLE: Record<WorkflowRunStatus, { label: string; chip: string }> = {
  running: { label: 'Workflow running', chip: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  awaiting_gate: { label: 'Needs approval', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  escalated: { label: 'Workflow needs you', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  interrupted: { label: 'Workflow interrupted', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  completed: { label: 'Ready to merge', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  cancelled: { label: 'Workflow cancelled', chip: 'bg-white/10 text-slate-400 border-white/10' },
}

/** Pill for a task's latest workflow run. */
export function WorkflowBadge({ status }: { status: WorkflowRunStatus | undefined }) {
  if (!status) return null
  const s = WORKFLOW_STATUS_STYLE[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.chip}`}
    >
      {status === 'running' ? (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-300/30 border-t-violet-300" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {s.label}
    </span>
  )
}

export const inputClass =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50'

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </div>
  )
}

export function Btn({
  kind = 'default',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'default' | 'primary' | 'danger' }) {
  const styles = {
    default: 'border border-white/10 text-slate-200 hover:bg-white/10',
    primary: 'bg-violet-500 text-white shadow-lg shadow-violet-500/20 hover:bg-violet-400',
    danger: 'border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
  }
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${styles[kind]}`}
    >
      {children}
    </button>
  )
}
