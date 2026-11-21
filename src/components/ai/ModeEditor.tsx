import { useEffect, useState } from 'react'
import {
  OUTPUT_TEMPLATES,
  TOOL_PRESETS,
  applyPreset,
  buildOutputSchema,
  describeOutput,
  modeWarnings,
  type OutputField,
  type OutputTemplateId,
} from '../../lib/agentTemplates'
import {
  BASELINE_DISALLOWED_TOOLS,
  type AgentModeDef,
  type JsonSchema,
  type OutcomeFromIssues,
  type PermissionMode,
} from '../../lib/workflowTypes'
import { inputClass } from '../ui'

const PERMISSION_HELP: Record<PermissionMode, string> = {
  plan: "Claude's plan mode: can read, can't change anything.",
  default: 'Only the allowed tools run; anything else is denied (sessions are headless).',
  acceptEdits: 'File edits are accepted automatically, plus the allowed tools.',
}

const FIELD_LABEL: Record<OutputField, string> = {
  plan: 'Plan (markdown + steps)',
  filesChanged: 'Files changed',
  issues: 'Issues with severity',
}

type Props = {
  mode: AgentModeDef
  /** `suggestRule` is set when a template with a severity rule was picked. */
  onChange: (mode: AgentModeDef, suggestRule?: OutcomeFromIssues) => void
}

/** One agent mode: what it's told, what it may do, and what it must return. */
export function ModeEditor({ mode, onChange }: Props) {
  const output = describeOutput(mode.outputSchema)
  const [advanced, setAdvanced] = useState(output === null)
  const warnings = modeWarnings(mode)
  const preset = Object.entries(TOOL_PRESETS).find(
    ([, p]) =>
      p.permissionMode === mode.permissionMode &&
      same(p.allowedTools, mode.allowedTools ?? []) &&
      same(p.disallowedTools, (mode.disallowedTools ?? []).filter((t) => !BASELINE_DISALLOWED_TOOLS.includes(t))),
  )?.[0]

  const setTemplate = (id: OutputTemplateId) => {
    if (id === 'custom') {
      onChange({ ...mode, outputSchema: buildOutputSchema(output?.verdicts ?? ['done'], output?.fields ?? []) })
      return
    }
    const t = OUTPUT_TEMPLATES[id]
    onChange({ ...mode, outputSchema: buildOutputSchema(t.verdicts, t.fields) }, t.severityRule)
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="text-xs text-slate-400">
        Instructions for this mode
        <textarea
          value={mode.instructions}
          onChange={(e) => onChange({ ...mode, instructions: e.target.value })}
          rows={4}
          className={`${inputClass} mt-1 resize-y`}
        />
        <span className="mt-1 block text-[11px] text-slate-500">
          Added to every stage prompt, after the ticket, plan, diff and feedback.
        </span>
      </label>

      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Tools & permissions</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(TOOL_PRESETS).map(([key, p]) => (
            <button
              key={key}
              type="button"
              title={p.description}
              onClick={() => onChange(applyPreset(mode, p))}
              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                preset === key
                  ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                  : 'border-white/10 text-slate-300 hover:border-white/25'
              }`}
            >
              {p.label}
            </button>
          ))}
          {!preset && <span className="self-center text-[11px] text-slate-500">custom</span>}
        </div>
        <label className="text-xs text-slate-400">
          Permission mode
          <select
            value={mode.permissionMode}
            onChange={(e) => onChange({ ...mode, permissionMode: e.target.value as PermissionMode })}
            className={`${inputClass} mt-1 block max-w-xs bg-slate-900`}
          >
            <option value="plan">plan</option>
            <option value="default">default</option>
            <option value="acceptEdits">acceptEdits</option>
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">{PERMISSION_HELP[mode.permissionMode]}</span>
        </label>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <ChipsEditor
            label="Allowed tools"
            placeholder="e.g. Bash(npm test:*)"
            values={mode.allowedTools ?? []}
            onChange={(allowedTools) => onChange({ ...mode, allowedTools })}
          />
          <ChipsEditor
            label="Denied tools"
            placeholder="e.g. Bash(rm:*)"
            values={(mode.disallowedTools ?? []).filter((t) => !BASELINE_DISALLOWED_TOOLS.includes(t))}
            locked={BASELINE_DISALLOWED_TOOLS}
            lockedTitle="Always denied in workflow sessions; can't be removed."
            onChange={(rules) =>
              onChange({
                ...mode,
                // Baseline rules the file already listed stay put; the engine adds them anyway.
                disallowedTools: [...(mode.disallowedTools ?? []).filter((t) => BASELINE_DISALLOWED_TOOLS.includes(t)), ...rules],
              })
            }
          />
        </div>
        {warnings.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {warnings.map((w) => (
              <li key={w} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                {w}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Output</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            Edit as JSON schema
          </label>
        </div>
        {advanced ? (
          <SchemaJson schema={mode.outputSchema} onChange={(outputSchema) => onChange({ ...mode, outputSchema })} />
        ) : output ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {([...Object.keys(OUTPUT_TEMPLATES), 'custom'] as OutputTemplateId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  title={id === 'custom' ? 'Your own verdicts' : OUTPUT_TEMPLATES[id as Exclude<OutputTemplateId, 'custom'>].description}
                  onClick={() => setTemplate(id)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    output.template === id
                      ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                      : 'border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  {id === 'custom' ? 'Custom' : OUTPUT_TEMPLATES[id as Exclude<OutputTemplateId, 'custom'>].label}
                </button>
              ))}
            </div>
            {output.template === 'custom' ? (
              <>
                <ChipsEditor
                  label="Verdicts (the outcomes a workflow routes on)"
                  placeholder="e.g. needs_info"
                  values={output.verdicts}
                  onChange={(verdicts) =>
                    verdicts.length > 0 && onChange({ ...mode, outputSchema: buildOutputSchema(verdicts, output.fields) })
                  }
                />
                <div className="flex flex-wrap gap-4 text-xs text-slate-300">
                  {(Object.keys(FIELD_LABEL) as OutputField[]).map((f) => (
                    <label key={f} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={output.fields.includes(f)}
                        onChange={(e) => {
                          const fields = e.target.checked ? [...output.fields, f] : output.fields.filter((x) => x !== f)
                          onChange({ ...mode, outputSchema: buildOutputSchema(output.verdicts, fields) })
                        }}
                      />
                      {FIELD_LABEL[f]}
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Verdicts: <span className="font-mono text-slate-200">{output.verdicts.join(', ')}</span>
                {output.fields.length > 0 && <> · also returns {output.fields.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}</>}
              </p>
            )}
            <p className="text-[11px] text-slate-500">Every result also has a summary. Invalid output is retried once, then escalated to you.</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
}

/** The raw output schema; kept as text until it parses. */
function SchemaJson({ schema, onChange }: { schema: JsonSchema; onChange: (s: JsonSchema) => void }) {
  const [text, setText] = useState(() => JSON.stringify(schema, null, 2))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText((t) => (safeParse(t) && JSON.stringify(safeParse(t)) === JSON.stringify(schema) ? t : JSON.stringify(schema, null, 2)))
  }, [schema])
  return (
    <div>
      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const parsed = safeParse(e.target.value)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setError(null)
            onChange(parsed as JsonSchema)
          } else {
            setError('Not valid JSON yet; the last valid schema is kept.')
          }
        }}
        rows={14}
        className={`${inputClass} resize-y font-mono text-xs`}
      />
      {error && <p className="mt-1 text-xs text-amber-300">{error}</p>}
      <p className="mt-1 text-[11px] text-slate-500">
        Needs a <code className="font-mono">verdict</code> string enum and a <code className="font-mono">summary</code> string, both required.
      </p>
    </div>
  )
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Editable list of short strings, with optional locked entries. */
export function ChipsEditor({
  label,
  placeholder,
  values,
  locked = [],
  lockedTitle,
  onChange,
}: {
  label: string
  placeholder: string
  values: string[]
  locked?: string[]
  lockedTitle?: string
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !values.includes(v) && !locked.includes(v)) onChange([...values, v])
    setDraft('')
  }
  return (
    <div className="text-xs text-slate-400">
      {label}
      <div className="mt-1 flex flex-wrap gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2">
        {locked.map((v) => (
          <span key={`locked-${v}`} title={lockedTitle} className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-500">
            🔒 {v}
          </span>
        ))}
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-200">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-slate-400 hover:text-rose-300"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          className="min-w-32 flex-1 bg-transparent px-1 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
        />
      </div>
    </div>
  )
}
