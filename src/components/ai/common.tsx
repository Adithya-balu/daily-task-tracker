import { useState } from 'react'
import { AI_ID, type AiEntrySource } from '../../lib/workflowTypes'
import { Btn, inputClass } from '../ui'

const SOURCE_STYLE: Record<AiEntrySource, { label: string; chip: string; title: string }> = {
  builtin: {
    label: 'Built-in',
    chip: 'bg-white/10 text-slate-300',
    title: 'Shipped with the app (workflows/). Editing saves your own copy.',
  },
  modified: {
    label: 'Modified',
    chip: 'bg-amber-500/15 text-amber-300',
    title: 'Your edit of a built-in. Reset to go back to the default.',
  },
  custom: { label: 'Custom', chip: 'bg-violet-500/15 text-violet-300', title: 'Created by you.' },
}

export function SourceBadge({ source }: { source: AiEntrySource }) {
  const s = SOURCE_STYLE[source]
  return (
    <span title={s.title} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.chip}`}>
      {s.label}
    </span>
  )
}

export type ListItem = { id: string; source: AiEntrySource; version: number | null; invalid: boolean; hint?: string }

/** Left-hand list of workflows or agents. */
export function EntryList({
  items,
  selected,
  onSelect,
  onNew,
  newLabel,
}: {
  items: ListItem[]
  selected: string | null
  onSelect: (id: string) => void
  onNew: () => void
  newLabel: string
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          aria-current={selected === item.id ? 'true' : undefined}
          className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition ${
            selected === item.id
              ? 'border-indigo-400/40 bg-indigo-500/10'
              : 'border-white/10 bg-white/[0.02] hover:border-white/20'
          }`}
        >
          <span className="flex items-center gap-2">
            {item.invalid && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-400" title="Has errors" />}
            <span className="truncate font-mono text-sm text-slate-100">{item.id}</span>
            {item.version != null && <span className="ml-auto text-[11px] text-slate-500">v{item.version}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source={item.source} />
            {item.hint && <span className="truncate text-[11px] text-slate-500">{item.hint}</span>}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onNew}
        className="mt-1 rounded-xl border border-dashed border-white/15 px-3 py-2 text-left text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
      >
        + {newLabel}
      </button>
    </div>
  )
}

/** Picks an id and what to start from for a new workflow or agent. */
export function NewEntryForm({
  kind,
  taken,
  starters,
  initialStarter,
  onCreate,
  onCancel,
}: {
  kind: 'workflow' | 'agent'
  taken: string[]
  starters: { value: string; label: string }[]
  initialStarter?: string
  onCreate: (id: string, starter: string) => void
  onCancel: () => void
}) {
  const [id, setId] = useState('')
  const [starter, setStarter] = useState(initialStarter ?? starters[0]?.value ?? '')
  const problem = !id
    ? null
    : !AI_ID.test(id)
      ? 'Use lowercase letters, digits, "-" and "_", starting with a letter or digit.'
      : taken.includes(id)
        ? `A ${kind} called "${id}" already exists.`
        : null

  return (
    <form
      className="rounded-2xl border border-white/10 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (id && !problem) onCreate(id, starter)
      }}
    >
      <div className="mb-3 text-sm font-semibold text-slate-100">New {kind}</div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-xs text-slate-400">
          Id
          <input
            autoFocus
            value={id}
            onChange={(e) => setId(e.target.value.trim())}
            placeholder={kind === 'workflow' ? 'e.g. quick-fix' : 'e.g. qa'}
            className={`${inputClass} mt-1 font-mono`}
          />
        </label>
        <label className="flex-1 text-xs text-slate-400">
          Start from
          <select
            value={starter}
            onChange={(e) => setStarter(e.target.value)}
            className={`${inputClass} mt-1 bg-slate-900`}
          >
            {starters.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {problem && <p className="mt-2 text-xs text-rose-300">{problem}</p>}
      <p className="mt-2 text-xs text-slate-500">The id can't be changed later; use Duplicate to make a renamed copy.</p>
      <div className="mt-3 flex gap-2">
        <Btn kind="primary" type="submit" disabled={!id || Boolean(problem)}>
          Create
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </form>
  )
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-0.5 text-xs text-rose-300">
      {errors.map((e) => (
        <li key={e} className="font-mono">
          {e}
        </li>
      ))}
    </ul>
  )
}

/** Save / Discard / Duplicate / Reset-or-Delete row shared by both editors. */
export function EditorActions({
  isNew,
  source,
  dirty,
  canSave,
  busy,
  error,
  onSave,
  onDiscard,
  onDuplicate,
  onRemove,
}: {
  isNew: boolean
  source: AiEntrySource | null
  dirty: boolean
  canSave: boolean
  busy: boolean
  error: string | null
  onSave: () => void
  onDiscard: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <div className="sticky bottom-0 -mx-1 mt-2 border-t border-white/10 bg-slate-950/90 px-1 py-3 backdrop-blur">
      {error && <p className="mb-2 whitespace-pre-wrap text-xs text-rose-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Btn kind="primary" disabled={busy || !dirty || !canSave} onClick={onSave}>
          {isNew ? 'Create' : 'Save'}
        </Btn>
        <Btn disabled={busy || !dirty} onClick={onDiscard}>
          {isNew ? 'Cancel' : 'Discard changes'}
        </Btn>
        {!isNew && (
          <Btn disabled={busy || dirty} onClick={onDuplicate} title={dirty ? 'Save or discard first' : undefined}>
            Duplicate
          </Btn>
        )}
        {!isNew && source !== 'builtin' && (
          <span className="ml-auto">
            <Btn kind="danger" disabled={busy} onClick={onRemove}>
              {source === 'modified' ? 'Reset to default' : 'Delete'}
            </Btn>
          </span>
        )}
        {dirty && !canSave && <span className="text-xs text-slate-500">Fix the errors to save.</span>}
      </div>
    </div>
  )
}
