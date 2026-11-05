import { useEffect, useState } from 'react'
import type { UseAgent } from '../hooks/useAgent'
import { buildTicket, resolveConfig } from '../lib/claude'
import { formatUsd } from '../lib/format'
import type { Project, Task } from '../lib/types'
import { gateView, isActiveRun, type WorkflowRun, type WorkflowSummary } from '../lib/workflowTypes'
import { Btn, FieldLabel, WorkflowBadge, inputClass } from './ui'
import { DiffView, IssueList, WorkflowTimeline } from './WorkflowTimeline'

type Props = {
  task: Task
  project: Project | null
  agentApi: UseAgent
  onWorkflowChange: (workflowId: string | undefined) => void
}

/** Run a task through a multi-agent workflow and approve its gates. */
export function WorkflowPanel({ task, project, agentApi, onWorkflowChange }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = agentApi.workflowRuns[task.id]?.[0]
  const active = isActiveRun(run)
  const { listWorkflows } = agentApi

  // Re-read on open so edits to workflows/*.json show up.
  useEffect(() => {
    listWorkflows()
      .then(setWorkflows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [listWorkflows])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {run && <RunHeader run={run} busy={busy} onCancel={() => act(() => agentApi.cancelWorkflow(task.id))} />}

      {run?.status === 'awaiting_gate' && (
        <GateCard
          run={run}
          busy={busy}
          onDecide={(decision, comment) => act(() => agentApi.decideGate(task.id, decision, comment))}
        />
      )}
      {(run?.status === 'escalated' || run?.status === 'interrupted') && (
        <EscalationCard run={run} busy={busy} onResume={(stage) => act(() => agentApi.retryWorkflow(task.id, stage))} />
      )}
      {run?.status === 'completed' && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm text-emerald-100">
          All stages passed and you approved the merge. Nothing has been merged: branch{' '}
          <code className="font-mono text-emerald-300">{run.branch}</code> is ready for you to merge.
        </div>
      )}
      {error && <div className="text-xs text-rose-300">{error}</div>}

      {!active && (
        <StartCard
          task={task}
          project={project}
          workflows={workflows}
          hasRun={Boolean(run)}
          busy={busy}
          onWorkflowChange={onWorkflowChange}
          onStart={(id) => act(() => agentApi.startWorkflow(task.id, id, buildTicket(task, project)))}
        />
      )}

      {run && (
        <div>
          <FieldLabel>Timeline</FieldLabel>
          <WorkflowTimeline run={run} />
        </div>
      )}
    </div>
  )
}

function RunHeader({ run, busy, onCancel }: { run: WorkflowRun; busy: boolean; onCancel: () => void }) {
  return (
    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <WorkflowBadge status={run.status} />
        <span className="text-sm text-slate-200">
          {run.workflow.name} <span className="text-slate-500">v{run.workflow.version}</span>
        </span>
        {run.currentStage && run.status === 'running' && (
          <span className="text-sm text-slate-400">· {run.currentStage}</span>
        )}
        {isActiveRun(run) && (
          <span className="ml-auto">
            <Btn kind="danger" disabled={busy} onClick={onCancel}>
              Cancel
            </Btn>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          Branch <code className="font-mono text-slate-300">{run.branch}</code>
        </span>
        <span title="Returns to an earlier stage, out of the loops allowed before it escalates to you">
          Loops {run.loops}/{run.loopBudget}
        </span>
        <span title="Estimated cost at API prices, out of the workflow's budget">
          ≈{formatUsd(run.totals.costUsd)} of {formatUsd(run.costBudgetUsd)}
        </span>
      </div>
    </div>
  )
}

function GateCard({
  run,
  busy,
  onDecide,
}: {
  run: WorkflowRun
  busy: boolean
  onDecide: (decision: 'approved' | 'rejected', comment: string) => void
}) {
  const [comment, setComment] = useState('')
  const stage = run.currentStage ?? ''
  const view = gateView(run, stage)
  const lastDiff = [...run.stages].reverse().find((r) => r.hasDiff)

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
      <div className="mb-1 text-sm font-semibold text-amber-200">
        {view === 'plan' ? 'Approve the plan?' : 'Approve these changes?'}
        <span className="ml-2 font-mono text-xs font-normal text-amber-300/70">{stage}</span>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        {view === 'plan'
          ? 'Approving starts implementation. Rejecting sends your comment back to the coder for a new plan.'
          : 'Approving finishes the workflow (nothing is merged automatically). Rejecting sends your comment back to the coder.'}
      </p>
      {view === 'plan' ? (
        run.handoff.plan ? (
          <pre className="mb-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 font-sans text-sm text-slate-200">
            {run.handoff.plan.text}
          </pre>
        ) : (
          <p className="mb-3 text-sm text-slate-500">No plan was produced.</p>
        )
      ) : lastDiff ? (
        <div className="mb-3">
          {lastDiff.diffStat && (
            <pre className="mb-2 overflow-x-auto font-mono text-[11px] text-slate-400">{lastDiff.diffStat.trim()}</pre>
          )}
          <DiffView taskId={run.taskId} recordId={lastDiff.id} />
        </div>
      ) : (
        <p className="mb-3 text-sm text-slate-500">No changes have been committed yet.</p>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Comment (required to reject; optional note with an approval)"
        className={`${inputClass} mb-3 resize-none`}
      />
      <div className="flex gap-2">
        <Btn kind="primary" disabled={busy} onClick={() => onDecide('approved', comment)}>
          Approve
        </Btn>
        <Btn disabled={busy || !comment.trim()} onClick={() => onDecide('rejected', comment)}>
          Reject with comment
        </Btn>
      </div>
    </div>
  )
}

function EscalationCard({
  run,
  busy,
  onResume,
}: {
  run: WorkflowRun
  busy: boolean
  onResume: (stage: string) => void
}) {
  const stages = Object.keys(run.definition.stages)
  const [stage, setStage] = useState(run.currentStage ?? stages[0])
  const e = run.escalation

  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4">
      <div className="mb-1 text-sm font-semibold text-rose-200">
        {run.status === 'interrupted' ? 'Interrupted' : 'Escalated to you'}
      </div>
      <p className="mb-3 text-sm text-slate-300">
        {e?.message ?? 'The app server restarted while a stage was running.'}
      </p>
      {e && e.loops.length > 0 && (
        <details className="mb-3" open={e.reason === 'max_loops'}>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-slate-400">
            What happened in each loop
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {e.loops.map((loop) => (
              <li key={loop.loopIndex} className="rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs">
                <div className="mb-1 font-semibold text-slate-300">
                  {loop.loopIndex === 0 ? 'First pass' : `Loop ${loop.loopIndex}`}
                </div>
                {loop.stages.map((s, i) => (
                  <div key={i} className="mb-1">
                    <span className="font-mono text-slate-400">{s.stage}</span>
                    {s.outcome && <span className="text-slate-500"> → {s.outcome}</span>}
                    {s.summary && <span className="text-slate-300">: {s.summary}</span>}
                    {s.issues.length > 0 && <IssueList issues={s.issues} />}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={stage}
          onChange={(ev) => setStage(ev.target.value)}
          className="rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none"
          aria-label="Stage to resume from"
        >
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Btn kind="primary" disabled={busy} onClick={() => onResume(stage)}>
          Resume from stage
        </Btn>
        {e?.reason === 'max_loops' && (
          <span className="text-xs text-slate-500">Resuming allows {run.definition.limits.max_loops} more loops.</span>
        )}
      </div>
    </div>
  )
}

function StartCard({
  task,
  project,
  workflows,
  hasRun,
  busy,
  onWorkflowChange,
  onStart,
}: {
  task: Task
  project: Project | null
  workflows: WorkflowSummary[] | null
  hasRun: boolean
  busy: boolean
  onWorkflowChange: (id: string | undefined) => void
  onStart: (id: string) => void
}) {
  const selected = workflows?.find((w) => w.id === task.workflowId)
  const missingDir = !resolveConfig(task, project).workingDir
  const missingCi = !project?.ciCommand?.trim()

  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <FieldLabel>{hasRun ? 'Run again' : 'Workflow'}</FieldLabel>
      <p className="mb-3 text-xs text-slate-500">
        The app runs each stage in a fresh headless Claude session on a new branch, reads its verdict, and decides
        what happens next. You approve the gates.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={task.workflowId ?? ''}
          onChange={(e) => onWorkflowChange(e.target.value || undefined)}
          className="min-w-48 rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-slate-200 outline-none"
          aria-label="Workflow"
        >
          <option value="">None (manual Claude runs)</option>
          {workflows?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.id}
              {w.version != null ? ` v${w.version}` : ''}
              {w.valid ? '' : ' (invalid)'}
            </option>
          ))}
        </select>
        <Btn
          kind="primary"
          disabled={busy || !selected?.valid || missingDir || missingCi}
          onClick={() => selected && onStart(selected.id)}
        >
          Start workflow
        </Btn>
      </div>
      {selected?.description && <p className="mt-2 text-sm text-slate-400">{selected.description}</p>}
      {selected && !selected.valid && (
        <ul className="mt-2 list-disc pl-5 text-xs text-rose-300">
          {selected.errors.map((e) => (
            <li key={e} className="font-mono">
              {e}
            </li>
          ))}
        </ul>
      )}
      {selected && (missingDir || missingCi) && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {missingDir
            ? 'Set a working folder (a git repository) for this task or its project first.'
            : project
              ? `Set a test & lint command on the "${project.name}" project (Projects) for the CI stage.`
              : 'Put this task in a project with a test & lint command for the CI stage.'}
        </div>
      )}
      {selected && !missingDir && !missingCi && (
        <p className="mt-2 text-xs text-slate-500">
          The working folder must be a git repository with no uncommitted changes.
        </p>
      )}
    </div>
  )
}
