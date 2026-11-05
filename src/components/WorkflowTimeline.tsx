import { useEffect, useState } from 'react'
import { totalTokens } from '../lib/agentTypes'
import { formatTokens, formatUsd } from '../lib/format'
import { formatDuration, formatTime } from '../lib/time'
import type { Issue, IssueSeverity, StageRecord, WorkflowRun } from '../lib/workflowTypes'
import { RunLog } from './RunLog'

const OUTCOME_STYLE: Record<string, string> = {
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  pass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  fail: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  changes_requested: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  rejected: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

export const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  blocker: 'bg-rose-500/20 text-rose-200',
  major: 'bg-amber-500/20 text-amber-200',
  minor: 'bg-white/10 text-slate-300',
}

const TYPE_LABEL: Record<StageRecord['type'], string> = { agent: 'agent', command: 'command', gate: 'you' }

/** Every stage a workflow run went through, grouped by pass, oldest first. */
export function WorkflowTimeline({ run }: { run: WorkflowRun }) {
  if (run.stages.length === 0) return <p className="text-sm text-slate-500">No stages have run yet.</p>
  const passes: StageRecord[][] = []
  for (const r of run.stages) {
    const last = passes[passes.length - 1]
    if (last && last[0].loopIndex === r.loopIndex) last.push(r)
    else passes.push([r])
  }
  return (
    <div className="flex flex-col gap-4">
      {passes.map((records) => (
        <div key={`${records[0].loopIndex}-${records[0].id}`}>
          {passes.length > 1 && (
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              {records[0].loopIndex === 0 ? 'First pass' : `Loop ${records[0].loopIndex}`}
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {records.map((r) => (
              <StageRow key={r.id} taskId={run.taskId} record={r} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

function StageRow({ taskId, record: r }: { taskId: string; record: StageRecord }) {
  const [open, setOpen] = useState<'log' | 'diff' | 'output' | null>(r.status === 'running' && r.runId ? 'log' : null)
  const toggle = (what: 'log' | 'diff' | 'output') => setOpen((o) => (o === what ? null : what))
  const dot =
    r.status === 'running'
      ? 'animate-pulse bg-violet-400'
      : r.status === 'waiting'
        ? 'bg-amber-400'
        : r.status === 'failed'
          ? 'bg-rose-400'
          : 'bg-emerald-400'

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="font-medium text-slate-100">{r.stage}</span>
        <span className="text-xs text-slate-500">{TYPE_LABEL[r.type]}</span>
        {r.outcome && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${OUTCOME_STYLE[r.outcome] ?? 'border-white/10 text-slate-300'}`}
          >
            {r.outcome.replace('_', ' ')}
          </span>
        )}
        {r.status === 'running' && <span className="text-xs text-violet-300">running…</span>}
        {r.status === 'waiting' && <span className="text-xs text-amber-300">waiting for you</span>}
        {r.normalized && (
          <span
            className="text-[11px] text-slate-500"
            title="The agent's own verdict didn't match its issues' severities; only blocker and major issues request changes."
          >
            (from issue severity)
          </span>
        )}
        {r.attempt > 1 && (
          <span className="text-[11px] text-amber-300" title="The first output was invalid, so the agent was asked again">
            retried
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 font-mono text-xs text-slate-500">
          <span>{formatTime(r.startedAt)}</span>
          {r.endedAt != null && <span>{formatDuration(Math.round(r.durationMs / 1000))}</span>}
          {r.type === 'agent' && (
            <span
              title={`in ${r.usage.input} · out ${r.usage.output} · cache read ${r.usage.cacheRead} · cache write ${r.usage.cacheWrite}`}
            >
              {formatTokens(totalTokens(r.usage))} tok · ≈{formatUsd(r.costUsd)}
            </span>
          )}
        </span>
      </div>

      {r.summary && r.type !== 'gate' && <div className="mt-1.5 whitespace-pre-wrap text-slate-300">{r.summary}</div>}
      {r.comment && <div className="mt-1.5 whitespace-pre-wrap text-slate-300">“{r.comment}”</div>}
      {r.error && <div className="mt-1.5 text-xs text-rose-300">{r.error}</div>}
      {r.issues.length > 0 && <IssueList issues={r.issues} />}
      {r.diffStat && <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-slate-500">{r.diffStat.trim()}</pre>}

      {(r.runId || r.hasDiff || r.commandOutput) && (
        <div className="mt-2 flex gap-3 text-xs">
          {r.runId && (
            <button type="button" onClick={() => toggle('log')} className="text-violet-300 hover:text-violet-200">
              {open === 'log' ? 'Hide log' : 'Session log'}
            </button>
          )}
          {r.hasDiff && (
            <button type="button" onClick={() => toggle('diff')} className="text-violet-300 hover:text-violet-200">
              {open === 'diff' ? 'Hide diff' : 'Diff'}
            </button>
          )}
          {r.commandOutput && (
            <button type="button" onClick={() => toggle('output')} className="text-violet-300 hover:text-violet-200">
              {open === 'output' ? 'Hide output' : 'Output'}
            </button>
          )}
        </div>
      )}
      {open === 'log' && r.runId && (
        <div className="mt-2">
          <RunLog taskId={taskId} runId={r.runId} />
        </div>
      )}
      {open === 'diff' && (
        <div className="mt-2">
          <DiffView taskId={taskId} recordId={r.id} />
        </div>
      )}
      {open === 'output' && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-slate-400">
          {r.commandOutput}
        </pre>
      )}
    </li>
  )
}

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {issues.map((i, n) => (
        <li key={n} className="flex gap-2 text-xs">
          <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 font-semibold ${SEVERITY_STYLE[i.severity]}`}>
            {i.severity}
          </span>
          <span className="min-w-0 text-slate-300">
            {i.file && (
              <span className="font-mono text-slate-400">
                {i.file}
                {i.line ? `:${i.line}` : ''}{' '}
              </span>
            )}
            {i.description}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The task branch's diff as saved after a stage. */
export function DiffView({ taskId, recordId }: { taskId: string; recordId: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setText(null)
    setError(null)
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow/diff/${encodeURIComponent(recordId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'No diff saved for this stage.' : `HTTP ${res.status}`)
        return res.text()
      })
      .then((t) => live && setText(t))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [taskId, recordId])

  if (error) return <div className="text-xs text-rose-300">{error}</div>
  if (text == null) return <div className="text-xs text-slate-500">Loading diff…</div>
  if (!text.trim()) return <div className="text-xs text-slate-500">No changes.</div>
  return (
    <pre className="max-h-[28rem] overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed">
      {text.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'text-emerald-300'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'text-rose-300'
                : line.startsWith('@@')
                  ? 'text-sky-300'
                  : line.startsWith('diff ')
                    ? 'mt-2 font-semibold text-slate-200'
                    : 'text-slate-500'
          }
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}
