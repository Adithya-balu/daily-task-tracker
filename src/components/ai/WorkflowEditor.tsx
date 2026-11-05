import { useEffect, useMemo, useState } from 'react'
import { flowPreview, freeStageId, moveStage, newStage, removeStage, renameStage, setStage } from '../../lib/workflowEdit'
import { startStage, validateWorkflow } from '../../lib/workflowValidate'
import type { AgentDef, AiEntrySource, StageType, WorkflowDef, WorkflowLimits } from '../../lib/workflowTypes'
import { FieldLabel, inputClass } from '../ui'
import { EditorActions, ErrorList, SourceBadge } from './common'
import { StageCard } from './StageCard'

const LIMITS: { key: keyof WorkflowLimits; label: string; help: string; step: number }[] = [
  {
    key: 'max_loops',
    label: 'Max loops',
    help: 'Times CI or an agent may send work back before it escalates to you. Your gate rejections don’t count.',
    step: 1,
  },
  { key: 'max_cost_usd', label: 'Max cost (USD)', help: 'Estimated spend before it escalates to you.', step: 0.5 },
  { key: 'timeout_minutes', label: 'Timeout (minutes)', help: 'Recorded with the run; enforced in a later phase.', step: 5 },
]

type Props = {
  id: string
  /** null while creating a workflow that hasn't been saved yet. */
  source: AiEntrySource | null
  initial: WorkflowDef
  agents: Record<string, AgentDef>
  onSave: (def: WorkflowDef, baseVersion: number | null) => Promise<void>
  onRemove: () => void
  onDuplicate: () => void
  onCancelNew: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function WorkflowEditor({
  id,
  source,
  initial,
  agents,
  onSave,
  onRemove,
  onDuplicate,
  onCancelNew,
  onDirtyChange,
}: Props) {
  const isNew = source === null
  const [def, setDef] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dirty = isNew || JSON.stringify(def) !== JSON.stringify(initial)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const errors = useMemo(() => validateWorkflow(def, agents), [def, agents])
  const ids = Object.keys(def.stages)
  const stageErrors = (sid: string) => errors.filter((e) => e.startsWith(`stages.${sid}.`) || e.startsWith(`stages.${sid}:`))
  const generalErrors = errors.filter((e) => !ids.some((sid) => stageErrors(sid).includes(e)))

  const save = async () => {
    setBusy(true)
    setSaveError(null)
    try {
      await onSave(def, isNew ? null : initial.version)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = (type: StageType) => {
    const sid = freeStageId(def, type === 'agent' ? 'agent' : type === 'command' ? 'ci' : 'approval')
    setDef(setStage(def, sid, newStage(type, agents)))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-lg text-white">{id}</h3>
        {source && <SourceBadge source={source} />}
        {!isNew && <span className="text-xs text-slate-500">v{initial.version}</span>}
        {dirty && !isNew && <span className="text-xs text-amber-300">unsaved changes</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-400 sm:col-span-2">
          Description
          <input
            value={def.description ?? ''}
            onChange={(e) => setDef({ ...def, description: e.target.value })}
            placeholder="What this workflow is for"
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs text-slate-400">
          Starts at
          <select
            value={ids.length ? startStage(def) : ''}
            onChange={(e) => {
              const { start: _start, ...rest } = def
              setDef(e.target.value === ids[0] ? rest : { ...rest, start: e.target.value })
            }}
            className={`${inputClass} mt-1 bg-slate-900`}
          >
            {ids.map((sid) => (
              <option key={sid} value={sid}>
                {sid}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <FieldLabel>Limits</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          {LIMITS.map((l) => (
            <label key={l.key} className="text-xs text-slate-400" title={l.help}>
              {l.label}
              <input
                type="number"
                min={0}
                step={l.step}
                value={Number.isFinite(def.limits[l.key]) ? def.limits[l.key] : ''}
                onChange={(e) => setDef({ ...def, limits: { ...def.limits, [l.key]: e.target.valueAsNumber } })}
                className={`${inputClass} mt-1 tabular-nums`}
              />
              <span className="mt-1 block text-[11px] text-slate-500">{l.help}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Stages</FieldLabel>
        {ids.length > 0 && (
          <p className="mb-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs leading-relaxed text-slate-300">
            {flowPreview(def)}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {ids.map((sid, i) => (
            <StageCard
              key={sid}
              id={sid}
              stage={def.stages[sid]}
              index={i}
              count={ids.length}
              isStart={startStage(def) === sid}
              stageIds={ids}
              agents={agents}
              errors={stageErrors(sid)}
              onChange={(stage) => setDef(setStage(def, sid, stage))}
              onRename={(to) => setDef(renameStage(def, sid, to))}
              onMove={(by) => setDef(moveStage(def, sid, by))}
              onRemove={() => setDef(removeStage(def, sid))}
            />
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="self-center text-xs text-slate-500">Add stage:</span>
          {(['agent', 'command', 'gate'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-slate-300 transition hover:border-white/30"
            >
              + {t}
            </button>
          ))}
        </div>
      </div>

      <ErrorList errors={generalErrors} />

      <EditorActions
        isNew={isNew}
        source={source}
        dirty={dirty}
        canSave={errors.length === 0}
        busy={busy}
        error={saveError}
        onSave={() => void save()}
        onDiscard={() => (isNew ? onCancelNew() : setDef(initial))}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  )
}
