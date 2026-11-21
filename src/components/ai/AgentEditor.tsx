import { useEffect, useMemo, useState } from 'react'
import { fitSeverityRule } from '../../lib/agentTemplates'
import { CLAUDE_EFFORTS, CLAUDE_MODELS, type ClaudeEffort, type ClaudeModel } from '../../lib/types'
import { AI_ID, type AgentDef, type AiEntrySource, type IssueSeverity } from '../../lib/workflowTypes'
import { validateAgent } from '../../lib/workflowValidate'
import { FieldLabel, inputClass } from '../ui'
import { EditorActions, ErrorList, SourceBadge } from './common'
import { ModeEditor } from './ModeEditor'

const SEVERITIES: IssueSeverity[] = ['blocker', 'major', 'minor']

type Props = {
  id: string
  /** null while creating an agent that hasn't been saved yet. */
  source: AiEntrySource | null
  initial: AgentDef
  initialPrompt: string
  usedBy: string[]
  /** Errors this definition would cause in workflows that use the agent. */
  workflowErrors: (def: AgentDef) => string[]
  onSave: (def: AgentDef, rolePrompt: string, baseVersion: number | null) => Promise<void>
  onRemove: () => void
  onDuplicate: () => void
  onCancelNew: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function AgentEditor({
  id,
  source,
  initial,
  initialPrompt,
  usedBy,
  workflowErrors,
  onSave,
  onRemove,
  onDuplicate,
  onCancelNew,
  onDirtyChange,
}: Props) {
  const isNew = source === null
  const [def, setDef] = useState(initial)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [modeName, setModeName] = useState(() => Object.keys(initial.modes)[0])
  const [newMode, setNewMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dirty = isNew || prompt !== initialPrompt || JSON.stringify(def) !== JSON.stringify(initial)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const errors = useMemo(() => validateAgent(def), [def])
  const breaks = useMemo(() => (errors.length ? [] : workflowErrors(def)), [errors, def, workflowErrors])
  const modes = Object.keys(def.modes)
  const mode = def.modes[modeName] ?? def.modes[modes[0]]
  const verdicts = [...new Set(Object.values(def.modes).flatMap((m) => m.outputSchema.properties?.verdict?.enum?.map(String) ?? []))]
  const hasIssues = Object.values(def.modes).some((m) => m.outputSchema.properties?.issues)
  const rule = def.outcomeFromIssues

  const save = async () => {
    setBusy(true)
    setSaveError(null)
    try {
      await onSave(def, prompt, isNew ? null : (initial.version ?? 0))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const modeProblem = !newMode
    ? null
    : !AI_ID.test(newMode)
      ? 'Lowercase letters, digits, "-" and "_".'
      : modes.includes(newMode)
        ? 'This agent already has that mode.'
        : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-lg text-white">{id}</h3>
        {source && <SourceBadge source={source} />}
        {!isNew && initial.version != null && <span className="text-xs text-slate-500">v{initial.version}</span>}
        {dirty && !isNew && <span className="text-xs text-amber-300">unsaved changes</span>}
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        {usedBy.length ? `Used by ${usedBy.join(', ')}.` : 'Not used by any workflow yet.'} Edits apply to runs started
        after saving.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-xs text-slate-400 sm:col-span-3">
          Description
          <input
            value={def.description ?? ''}
            onChange={(e) => setDef({ ...def, description: e.target.value || undefined })}
            placeholder="What this agent is for"
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs text-slate-400">
          Model
          <select
            value={def.model ?? ''}
            onChange={(e) => setDef({ ...def, model: (e.target.value || undefined) as ClaudeModel | undefined })}
            className={`${inputClass} mt-1 bg-slate-900`}
          >
            <option value="">Task's model</option>
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Effort
          <select
            value={def.effort ?? ''}
            onChange={(e) => setDef({ ...def, effort: (e.target.value || undefined) as ClaudeEffort | undefined })}
            className={`${inputClass} mt-1 bg-slate-900`}
          >
            <option value="">Task's effort</option>
            {CLAUDE_EFFORTS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <p className="self-end text-[11px] text-slate-500">When set, these override the task's settings for this agent's stages.</p>
      </div>

      <label className="text-xs text-slate-400">
        Role prompt (markdown)
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          spellCheck={false}
          className={`${inputClass} mt-1 resize-y font-mono text-xs leading-relaxed`}
        />
        <span className="mt-1 block text-[11px] text-slate-500">
          Appended to the system prompt of every session this agent runs, in any mode.
        </span>
      </label>

      <div>
        <FieldLabel>Modes</FieldLabel>
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {modes.map((m) => (
            <span
              key={m}
              className={`flex items-center rounded-lg border text-sm ${
                m === modeName ? 'border-indigo-400/50 bg-indigo-500/15 text-white' : 'border-white/10 text-slate-300'
              }`}
            >
              <button type="button" onClick={() => setModeName(m)} className="px-3 py-1 font-mono text-xs">
                {m}
              </button>
              {modes.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove mode ${m}`}
                  title="Remove mode"
                  onClick={() => {
                    const rest = { ...def.modes }
                    delete rest[m]
                    setDef(fitSeverityRule({ ...def, modes: rest }))
                    if (m === modeName) setModeName(Object.keys(rest)[0])
                  }}
                  className="pr-2 text-xs text-slate-500 hover:text-rose-300"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newMode || modeProblem) return
              const copy = structuredClone(mode)
              setDef({ ...def, modes: { ...def.modes, [newMode]: copy } })
              setModeName(newMode)
              setNewMode('')
            }}
          >
            <input
              value={newMode}
              onChange={(e) => setNewMode(e.target.value.trim())}
              placeholder="new mode"
              aria-label="New mode name"
              className="w-28 rounded-lg border border-dashed border-white/15 bg-transparent px-2 py-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-500"
            />
            {newMode && (
              <button type="submit" disabled={Boolean(modeProblem)} className="text-xs text-violet-300 disabled:opacity-40">
                Add (copy of {modeName})
              </button>
            )}
          </form>
        </div>
        {modeProblem && <p className="-mt-2 mb-3 text-xs text-rose-300">{modeProblem}</p>}
        {mode && (
          <ModeEditor
            key={modeName}
            mode={mode}
            onChange={(next, suggestRule) =>
              setDef(fitSeverityRule({ ...def, modes: { ...def.modes, [modeName]: next } }, suggestRule))
            }
          />
        )}
      </div>

      {hasIssues && (
        <section className="rounded-2xl border border-white/10 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={Boolean(rule)}
              onChange={(e) => {
                if (e.target.checked) {
                  const [clear, blocked] = verdicts
                  setDef({ ...def, outcomeFromIssues: { blocking: ['blocker', 'major'], blocked: blocked ?? clear, clear } })
                } else {
                  const { outcomeFromIssues: _rule, ...rest } = def
                  setDef(rest)
                }
              }}
            />
            Decide the verdict from issue severity
          </label>
          <p className="mt-1 text-xs text-slate-500">
            The agent's own verdict is overridden: any issue with a blocking severity gives the "blocked" verdict,
            otherwise "clear". The timeline marks overridden verdicts.
          </p>
          {rule && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-300">
              <span className="flex items-center gap-3">
                Blocking:
                {SEVERITIES.map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={rule.blocking.includes(s)}
                      onChange={(e) =>
                        setDef({
                          ...def,
                          outcomeFromIssues: {
                            ...rule,
                            blocking: e.target.checked ? [...rule.blocking, s] : rule.blocking.filter((x) => x !== s),
                          },
                        })
                      }
                    />
                    {s}
                  </label>
                ))}
              </span>
              {(['blocked', 'clear'] as const).map((k) => (
                <label key={k} className="flex items-center gap-1.5">
                  {k === 'blocked' ? 'Blocked →' : 'Clear →'}
                  <select
                    value={rule[k]}
                    onChange={(e) => setDef({ ...def, outcomeFromIssues: { ...rule, [k]: e.target.value } })}
                    className="rounded-md border border-white/10 bg-slate-900 px-1.5 py-1 font-mono text-xs"
                  >
                    {verdicts.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      <ErrorList errors={[...errors, ...breaks.map((e) => `would break ${e}`)]} />

      <EditorActions
        isNew={isNew}
        source={source}
        dirty={dirty}
        canSave={errors.length === 0 && breaks.length === 0 && prompt.trim().length > 0}
        busy={busy}
        error={saveError}
        onSave={() => void save()}
        onDiscard={() => {
          if (isNew) return onCancelNew()
          setDef(initial)
          setPrompt(initialPrompt)
        }}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  )
}
