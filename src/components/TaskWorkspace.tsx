import { useEffect, useState } from 'react'
import type { AgentState } from '../lib/agentTypes'
import type { ClaudeConfig, PlanStep, Project, Reference, Task } from '../lib/types'
import type { UseAgent } from '../hooks/useAgent'
import { formatDuration } from '../lib/time'
import { ActivityTimeline } from './ActivityTimeline'
import { ClaudePanel } from './ClaudePanel'
import { NotesEditor } from './NotesEditor'
import { PlanEditor } from './PlanEditor'
import { ReferencesPanel } from './ReferencesPanel'
import { AgentBadge, PriorityChip } from './ui'

type Tab = 'plan' | 'notes' | 'references' | 'claude' | 'activity'

type Props = {
  task: Task
  project: Project | null
  projects: Project[]
  agent: AgentState | undefined
  agentApi: UseAgent
  isActive: boolean
  onClose: () => void
  onTitleChange: (id: string, title: string) => void
  onNotesChange: (id: string, notes: string) => void
  onResumeNoteChange: (id: string, note: string) => void
  onPlanChange: (id: string, plan: PlanStep[]) => void
  onReferencesChange: (id: string, refs: Reference[]) => void
  onProjectChange: (id: string, projectId: string | null) => void
  onClaudeConfigChange: (id: string, patch: Partial<ClaudeConfig>) => void
  onShareNotesChange: (id: string, share: boolean) => void
  onFocus: (id: string) => void
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

const STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

function initialTab(agent: AgentState | undefined): Tab {
  switch (agent?.status) {
    case 'running':
    case 'in_terminal':
    case 'done':
    case 'failed':
    case 'interrupted':
      return 'claude'
    default:
      return 'plan'
  }
}

/** Side drawer with everything about one task: plan, notes, references, Claude, activity. */
export function TaskWorkspace(props: Props) {
  const { task, project, projects, agent, isActive, onClose } = props
  const [tab, setTab] = useState<Tab>(() => initialTab(agent))
  const [focusRunId, setFocusRunId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isDone = task.status === 'done'
  const planDone = task.plan.filter((s) => s.status === 'done').length
  const refCount = task.references.length + (project?.references.length ?? 0)

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: 'plan', label: 'Plan', badge: task.plan.length ? `${planDone}/${task.plan.length}` : undefined },
    { id: 'notes', label: 'Notes' },
    { id: 'references', label: 'References', badge: refCount ? String(refCount) : undefined },
    { id: 'claude', label: 'Claude', badge: agent?.totals.runs ? String(agent.totals.runs) : undefined },
    {
      id: 'activity',
      label: 'Activity',
      badge: task.sessionLog.length ? String(task.sessionLog.length) : undefined,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="animate-slide-in flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-slate-900/[0.98] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-white/10 p-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <input
              value={task.title}
              onChange={(e) => props.onTitleChange(task.id, e.target.value)}
              onBlur={(e) => {
                const next = e.target.value.trim() || 'Untitled'
                if (next !== task.title) props.onTitleChange(task.id, next)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className="min-w-0 flex-1 rounded-lg bg-transparent text-xl font-bold text-white outline-none ring-indigo-400/40 focus:ring-2"
              aria-label="Task title"
            />
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
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <PriorityChip priority={task.priority} />
            <span className="rounded-full bg-white/10 px-2 py-0.5">{STATUS_LABEL[task.status]}</span>
            <select
              value={task.projectId ?? ''}
              onChange={(e) => props.onProjectChange(task.id, e.target.value || null)}
              className="rounded-full border border-white/10 bg-transparent px-2 py-0.5 text-xs text-slate-300 outline-none"
              title="Project"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <AgentBadge status={agent?.status} openedIn={agent?.openedIn} />
            {task.pomodorosCompleted > 0 && (
              <span>
                {task.pomodorosCompleted} pomo &middot; {formatDuration(task.focusedSeconds)} focused
              </span>
            )}
          </div>

          {/* Resume here stays visible on every tab. */}
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
              Resume here
            </label>
            <textarea
              value={task.resumeNote}
              onChange={(e) => props.onResumeNoteChange(task.id, e.target.value)}
              rows={1}
              placeholder="The one thing to pick up first when you (or Claude) return."
              className="mt-0.5 w-full resize-none bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none [field-sizing:content]"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                tab === t.id
                  ? 'border-indigo-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
              {t.id === 'claude' && agent?.status === 'running' && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
              )}
              {t.badge && <span className="text-xs text-slate-500">{t.badge}</span>}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'plan' && (
            <>
              {agent?.status === 'awaiting_review' && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Claude proposed this plan. Edit it, then approve it on the Claude tab.
                  <button
                    type="button"
                    onClick={() => setTab('claude')}
                    className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1 text-xs font-semibold hover:bg-amber-500/30"
                  >
                    Review
                  </button>
                </div>
              )}
              <PlanEditor
                steps={task.plan}
                onChange={(plan) => props.onPlanChange(task.id, plan)}
                notes={task.notes}
              />
            </>
          )}
          {tab === 'notes' && (
            <>
              <p className="mb-2 text-xs text-slate-500">
                Private scratchpad.{' '}
                {task.shareNotesWithClaude
                  ? 'Currently included in Claude’s prompt.'
                  : 'Not sent to Claude unless you turn it on in Claude › Run settings.'}
              </p>
              <NotesEditor
                key={task.id}
                value={task.notes}
                onChange={(v) => props.onNotesChange(task.id, v)}
                rows={14}
              />
            </>
          )}
          {tab === 'references' && (
            <ReferencesPanel
              references={task.references}
              onChange={(refs) => props.onReferencesChange(task.id, refs)}
              inherited={project?.references}
              inheritedFrom={project?.name}
            />
          )}
          {tab === 'claude' && (
            <ClaudePanel
              task={task}
              project={project}
              agent={agent}
              agentApi={props.agentApi}
              onConfigChange={(patch) => props.onClaudeConfigChange(task.id, patch)}
              onShareNotesChange={(share) => props.onShareNotesChange(task.id, share)}
              focusRunId={focusRunId}
            />
          )}
          {tab === 'activity' && (
            <ActivityTimeline
              entries={task.sessionLog}
              onOpenRun={(runId) => {
                setFocusRunId(runId)
                setTab('claude')
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 p-4">
          <button
            onClick={() => {
              props.onDelete(task.id)
              onClose()
            }}
            className="rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:text-rose-400"
          >
            Delete
          </button>
          <div className="flex items-center gap-2">
            {!isDone && tab !== 'claude' && (
              <button
                onClick={() => setTab('claude')}
                className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/20 active:scale-95"
              >
                Claude…
              </button>
            )}
            {!isDone && (
              <button
                onClick={() => {
                  props.onComplete(task.id)
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
                  props.onFocus(task.id)
                  onClose()
                }}
                className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-95"
              >
                {isActive ? 'Refocus' : 'Focus'}
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
