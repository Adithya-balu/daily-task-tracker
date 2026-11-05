import { useEffect, useState } from 'react'
import { newStage, syncTransitions } from '../../lib/workflowEdit'
import { stageOutcomes } from '../../lib/workflowValidate'
import { AI_ID, DONE, type AgentDef, type StageDef, type StageType } from '../../lib/workflowTypes'
import { inputClass } from '../ui'
import { ErrorList } from './common'

const TYPE_HELP: Record<StageType, string> = {
  agent: 'A fresh headless Claude session; its verdict picks the next stage.',
  command: 'A shell command in the task folder; exit code 0 is pass.',
  gate: 'Waits for you to approve or reject.',
}

const selectClass = `${inputClass} bg-slate-900`
/** inputClass without its full width, for fields sized inline. */
const inlineClass = inputClass.replace('w-full ', '')

type Props = {
  id: string
  stage: StageDef
  index: number
  count: number
  isStart: boolean
  stageIds: string[]
  agents: Record<string, AgentDef>
  errors: string[]
  onChange: (stage: StageDef) => void
  onRename: (to: string) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}

/** One stage of the workflow form: what it runs and where each outcome goes. */
export function StageCard({
  id,
  stage,
  index,
  count,
  isStart,
  stageIds,
  agents,
  errors,
  onChange,
  onRename,
  onMove,
  onRemove,
}: Props) {
  const [name, setName] = useState(id)
  useEffect(() => setName(id), [id])
  const nameProblem =
    name === id
      ? null
      : !AI_ID.test(name) || name === DONE
        ? 'Lowercase letters, digits, "-" and "_" ("done" is reserved).'
        : stageIds.includes(name)
          ? 'Another stage has this id.'
          : null
  const commitName = () => {
    if (name !== id && !nameProblem) onRename(name)
    else setName(id)
  }

  const outcomes = stageOutcomes(stage, agents) ?? Object.keys(stage.next)
  const agent = stage.type === 'agent' ? agents[stage.agent] : undefined
  const targets = [...stageIds, DONE]

  return (
    <li className={`rounded-2xl border p-4 ${errors.length ? 'border-rose-500/30' : 'border-white/10'} bg-white/[0.02]`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 shrink-0 text-xs tabular-nums text-slate-500">{index + 1}.</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.trim())}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
          aria-label="Stage id"
          className={`${inlineClass} w-44 font-mono`}
        />
        <select
          value={stage.type}
          onChange={(e) => {
            const type = e.target.value as StageType
            onChange(syncTransitions({ ...newStage(type, agents), next: stage.next }, agents))
          }}
          aria-label="Stage type"
          className={`${inlineClass} w-32 bg-slate-900`}
        >
          <option value="agent">agent</option>
          <option value="command">command</option>
          <option value="gate">gate</option>
        </select>
        {isStart && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">start</span>}
        <span className="ml-auto flex gap-1">
          <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <IconBtn label="Remove stage" onClick={onRemove}>
            ✕
          </IconBtn>
        </span>
      </div>
      {nameProblem && <p className="mt-1 pl-8 text-xs text-rose-300">{nameProblem}</p>}
      <p className="mt-1 pl-8 text-xs text-slate-500">{TYPE_HELP[stage.type]}</p>

      <div className="mt-3 grid gap-3 pl-8 sm:grid-cols-2">
        {stage.type === 'agent' && (
          <>
            <label className="text-xs text-slate-400">
              Agent
              <select
                value={stage.agent}
                onChange={(e) => {
                  const next = agents[e.target.value]
                  const mode = next ? Object.keys(next.modes)[0] : stage.mode
                  onChange(syncTransitions({ ...stage, agent: e.target.value, mode }, agents))
                }}
                className={`${selectClass} mt-1`}
              >
                {!agent && <option value={stage.agent}>{stage.agent || '(choose)'} (missing)</option>}
                {Object.keys(agents).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Mode
              <select
                value={stage.mode ?? 'default'}
                onChange={(e) => onChange(syncTransitions({ ...stage, mode: e.target.value }, agents))}
                className={`${selectClass} mt-1`}
              >
                {agent && !agent.modes[stage.mode ?? 'default'] && (
                  <option value={stage.mode ?? 'default'}>{stage.mode ?? 'default'} (missing)</option>
                )}
                {Object.keys(agent?.modes ?? {}).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {stage.type === 'command' && (
          <label className="text-xs text-slate-400 sm:col-span-2">
            Command
            <input
              value={stage.run}
              onChange={(e) => onChange({ ...stage, run: e.target.value })}
              className={`${inputClass} mt-1 font-mono`}
            />
            <span className="mt-1 block text-slate-500">
              <code className="font-mono">{'{{project.ciCommand}}'}</code> is the project's "Test & lint command".
            </span>
          </label>
        )}
        {stage.type === 'gate' && (
          <label className="text-xs text-slate-400">
            Shows you
            <select
              value={stage.show ?? 'diff'}
              onChange={(e) => onChange({ ...stage, show: e.target.value as 'plan' | 'diff' })}
              className={`${selectClass} mt-1`}
            >
              <option value="plan">the plan</option>
              <option value="diff">the branch diff</option>
            </select>
          </label>
        )}
      </div>

      <div className="mt-3 pl-8">
        <div className="mb-1 text-xs text-slate-400">Then</div>
        <div className="flex flex-col gap-1.5">
          {outcomes.map((o) => {
            const target = stage.next[o]
            const missing = target !== undefined && !targets.includes(target)
            return (
              <div key={o} className="flex items-center gap-2 text-sm">
                <span className="w-40 shrink-0 truncate font-mono text-xs text-slate-300">{o}</span>
                <span className="text-slate-500">→</span>
                <select
                  value={target ?? ''}
                  onChange={(e) => onChange({ ...stage, next: { ...stage.next, [o]: e.target.value } })}
                  aria-label={`Next stage after ${o}`}
                  className={`${inlineClass} w-56 bg-slate-900 py-1.5`}
                >
                  {target === undefined && <option value="">(choose)</option>}
                  {missing && <option value={target}>{target} (missing)</option>}
                  {targets.map((t) => (
                    <option key={t} value={t}>
                      {t === DONE ? 'done (finish)' : t}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
          {outcomes.length === 0 && <span className="text-xs text-slate-500">Pick an agent to see its outcomes.</span>}
        </div>
      </div>
      <div className="pl-8">
        <ErrorList errors={errors} />
      </div>
    </li>
  )
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 rounded-lg border border-white/10 text-xs text-slate-400 transition hover:bg-white/10 hover:text-slate-200 disabled:opacity-30"
    >
      {children}
    </button>
  )
}
