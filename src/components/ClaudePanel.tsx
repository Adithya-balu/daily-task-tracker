import { useEffect, useState } from 'react'
import type { AgentState } from '../lib/agentTypes'
import { totalTokens } from '../lib/agentTypes'
import type { ClaudeConfig, Project, Task } from '../lib/types'
import {
  buildHandoffPrompt,
  buildPrompt,
  buildRunRequest,
  modeFor,
  resolveConfig,
  resolveProjectConfig,
  type RunKind,
} from '../lib/claude'
import type { UseAgent } from '../hooks/useAgent'
import { formatTokens, formatUsd } from '../lib/format'
import { formatDuration, formatTime } from '../lib/time'
import { ClaudeSettingsFields } from './ClaudeSettingsFields'
import { RunLog } from './RunLog'
import { AgentBadge, Btn, FieldLabel, inputClass } from './ui'

type Props = {
  task: Task
  project: Project | null
  agent: AgentState | undefined
  agentApi: UseAgent
  onConfigChange: (patch: Partial<ClaudeConfig>) => void
  onShareNotesChange: (share: boolean) => void
  /** Run whose log to show (e.g. picked from the Activity tab). */
  focusRunId: string | null
}

export function ClaudePanel({
  task,
  project,
  agent,
  agentApi,
  onConfigChange,
  onShareNotesChange,
  focusRunId,
}: Props) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewRunId, setViewRunId] = useState<string | null>(focusRunId)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => setViewRunId(focusRunId), [focusRunId])

  const status = agent?.status ?? 'idle'
  const hasSession = Boolean(agent?.sessionId)
  const config = resolveConfig(task, project)
  const missingDir = !config.workingDir

  // A new run's log replaces whatever you were looking at.
  useEffect(() => {
    if (agent?.activeRunId) setViewRunId(null)
  }, [agent?.activeRunId])

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

  const run = (kind: RunKind, fork = false) =>
    act(async () => {
      await agentApi.run(task.id, buildRunRequest(task, project, kind, message, fork))
      setMessage('')
    })

  const previewKind: RunKind =
    status === 'awaiting_review' ? 'approve' : hasSession ? 'continue' : 'start'
  const shownRunId = viewRunId ?? agent?.activeRunId ?? agent?.runs[0]?.id ?? null
  const shownRun = agent?.runs.find((r) => r.id === shownRunId)

  return (
    <div className="flex flex-col gap-5">
      {/* Status + actions */}
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <AgentBadge status={status} openedIn={agent?.openedIn} />
          {status === 'idle' && (
            <span className="text-sm text-slate-400">
              {hasSession ? 'Session saved - continue any time.' : 'Claude hasn’t worked on this yet.'}
            </span>
          )}
          {status === 'awaiting_review' && (
            <span className="text-sm text-slate-300">
              Review the plan in the Plan tab, edit it if needed, then approve.
            </span>
          )}
          {status === 'in_terminal' && (
            <span className="text-sm text-slate-300">
              Continuing in {agent?.openedIn === 'vscode' ? 'VS Code' : 'Terminal'}. Runs from here
              are paused until you’re back.
            </span>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {config.model} · {modeFor(previewKind, config) === 'plan' ? 'plan mode' : config.executeMode}
            {config.useWorktree && ' · worktree'}
          </span>
        </div>

        {agent?.error && status !== 'running' && (
          <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {agent.error}
          </div>
        )}
        {missingDir && !hasSession && (
          <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Set a working folder in Run settings below{project ? ' or on the project' : ''} so Claude
            knows where to work.
          </div>
        )}

        {status !== 'running' && status !== 'in_terminal' && (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder={
              status === 'awaiting_review'
                ? 'Optional: feedback for a revised plan, or a note to go with your approval'
                : hasSession
                  ? 'Message to Claude (optional) - e.g. “now add tests”'
                  : 'Extra instructions (optional)'
            }
            className={`${inputClass} mb-3 resize-none`}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {status === 'running' && (
            <Btn kind="danger" disabled={busy} onClick={() => act(() => agentApi.stop(task.id))}>
              Stop
            </Btn>
          )}
          {status === 'in_terminal' && (
            <Btn kind="primary" disabled={busy} onClick={() => act(() => agentApi.markBack(task.id))}>
              I’m back
            </Btn>
          )}
          {status === 'awaiting_review' && (
            <>
              <Btn kind="primary" disabled={busy} onClick={() => run('approve')}>
                Approve plan &amp; run
              </Btn>
              <Btn disabled={busy || !message.trim()} onClick={() => run('revise')}>
                Revise plan
              </Btn>
            </>
          )}
          {status !== 'running' && status !== 'in_terminal' && status !== 'awaiting_review' && (
            <>
              {hasSession && (
                <Btn kind="primary" disabled={busy} onClick={() => run('continue')}>
                  Continue
                </Btn>
              )}
              <Btn
                kind={hasSession ? 'default' : 'primary'}
                disabled={busy || missingDir}
                onClick={() => run('start')}
              >
                {hasSession ? 'Start fresh' : config.planFirst ? 'Plan with Claude' : 'Run with Claude'}
              </Btn>
              {hasSession && (
                <Btn disabled={busy} onClick={() => run('continue', true)} title="Continue in a new branch of the session">
                  Fork
                </Btn>
              )}
            </>
          )}
          {hasSession && status !== 'running' && status !== 'in_terminal' && (
            <>
              <Btn
                disabled={busy}
                onClick={() =>
                  act(() => agentApi.openVSCode(task.id, buildHandoffPrompt(task, project, agent)))
                }
                title="Start a new Claude chat in this project's VS Code window, with this task's context"
              >
                Open in VS Code
              </Btn>
              <Btn disabled={busy} onClick={() => act(() => agentApi.openTerminal(task.id))}>
                Open in Terminal
              </Btn>
            </>
          )}
          {(status === 'done' || status === 'failed' || status === 'interrupted' || status === 'awaiting_review') && (
            <button
              type="button"
              onClick={() => act(() => agentApi.acknowledge(task.id))}
              className="ml-auto text-xs text-slate-500 hover:text-slate-300"
            >
              Dismiss
            </button>
          )}
        </div>
        {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}
      </div>

      {/* Log of the current / selected run */}
      {shownRunId && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <FieldLabel>{agent?.activeRunId === shownRunId ? 'Live output' : 'Run log'}</FieldLabel>
            {shownRun && (
              <span className="text-xs text-slate-500">
                {formatTime(shownRun.startedAt)} · {shownRun.mode}
              </span>
            )}
          </div>
          {shownRun?.fromTerminal ? (
            <p className="text-sm text-slate-500">This session ran in Terminal; its log lives there.</p>
          ) : (
            <RunLog taskId={task.id} runId={shownRunId} />
          )}
        </div>
      )}

      {/* Run history */}
      {agent && agent.runs.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <FieldLabel>Runs</FieldLabel>
            <span
              className="text-xs text-slate-500"
              title="Estimated cost at API prices. On a Team plan you're not billed per token; this is drawn from your plan's usage limits."
            >
              {formatTokens(totalTokens(agent.totals))} tokens · ≈{formatUsd(agent.totals.costUsd)} ·{' '}
              {agent.totals.runs} run{agent.totals.runs === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium" title="input / output / cache read / cache write">
                    Tokens
                  </th>
                  <th className="px-3 py-2 text-right font-medium">≈Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {agent.runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setViewRunId(r.id)}
                    className={`cursor-pointer border-t border-white/5 hover:bg-white/[0.04] ${
                      r.id === shownRunId ? 'bg-white/[0.05]' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-slate-300">
                      <span
                        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                          r.endedAt == null ? 'bg-violet-400' : r.isError ? 'bg-rose-400' : 'bg-emerald-400'
                        }`}
                      />
                      {formatTime(r.startedAt)}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{r.fromTerminal ? 'terminal' : r.mode}</td>
                    <td className="max-w-40 truncate px-3 py-2 text-slate-400">{r.model ?? '-'}</td>
                    <td
                      className="px-3 py-2 text-right font-mono text-slate-300"
                      title={`in ${r.usage.input} · out ${r.usage.output} · cache read ${r.usage.cacheRead} · cache write ${r.usage.cacheWrite}`}
                    >
                      {formatTokens(totalTokens(r.usage))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {r.fromTerminal ? '-' : formatUsd(r.costUsd)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">
                      {formatDuration(Math.round(r.durationMs / 1000))}
                      {r.permissionDenials > 0 && (
                        <span className="ml-1 text-amber-300" title="Tool calls denied by permissions">
                          ⚠{r.permissionDenials}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settings + preview */}
      <div className="rounded-2xl border border-white/10">
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-300"
        >
          Run settings
          <span className="text-xs text-slate-500">{showSettings ? 'Hide' : 'Show'}</span>
        </button>
        {showSettings && (
          <div className="flex flex-col gap-4 border-t border-white/10 p-4">
            <ClaudeSettingsFields
              value={task.claude}
              inherited={resolveProjectConfig(project)}
              inheritLabel={project ? project.name : 'Default'}
              onChange={onConfigChange}
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={task.shareNotesWithClaude}
                onChange={(e) => onShareNotesChange(e.target.checked)}
                className="accent-violet-400"
              />
              Include my private notes in the prompt
            </label>
          </div>
        )}
      </div>

      <details className="rounded-2xl border border-white/10">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300">
          Preview prompt
          <span className="ml-2 text-xs font-normal text-slate-500">what “{previewKind}” would send</span>
        </summary>
        <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap border-t border-white/10 p-4 font-mono text-xs text-slate-400">
          {buildPrompt(task, project, previewKind, message)}
        </pre>
      </details>
    </div>
  )
}
