import { useState } from 'react'
import type { Reference, ReferenceKind } from '../lib/types'
import { uid } from '../lib/storage'
import { inputClass } from './ui'

const KIND_LABEL: Record<ReferenceKind, string> = {
  url: 'Link',
  path: 'File / folder',
  snippet: 'Snippet',
}

const KIND_PLACEHOLDER: Record<ReferenceKind, string> = {
  url: 'https://…',
  path: '/Users/you/project/docs/spec.md',
  snippet: 'Paste text, an error, an API response…',
}

type Props = {
  references: Reference[]
  onChange: (refs: Reference[]) => void
  /** Read-only references inherited from the task's project. */
  inherited?: Reference[]
  inheritedFrom?: string
}

export function ReferencesPanel({ references, onChange, inherited = [], inheritedFrom }: Props) {
  const [kind, setKind] = useState<ReferenceKind>('url')
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')

  const add = () => {
    const v = value.trim()
    if (!v) return
    onChange([
      ...references,
      { id: uid(), kind, label: label.trim(), value: v, includeInContext: true, createdAt: Date.now() },
    ])
    setLabel('')
    setValue('')
  }

  return (
    <div className="flex flex-col gap-4">
      {references.length === 0 && inherited.length === 0 && (
        <p className="text-sm text-slate-500">
          Attach links, local files or pasted text. Anything marked “Send to Claude” goes into the
          prompt when Claude works on this.
        </p>
      )}

      {references.length > 0 && (
        <ul className="flex flex-col gap-2">
          {references.map((r) => (
            <ReferenceRow
              key={r.id}
              reference={r}
              onToggle={() =>
                onChange(
                  references.map((x) =>
                    x.id === r.id ? { ...x, includeInContext: !x.includeInContext } : x,
                  ),
                )
              }
              onRemove={() => onChange(references.filter((x) => x.id !== r.id))}
            />
          ))}
        </ul>
      )}

      {inherited.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs text-slate-500">From project {inheritedFrom}</div>
          <ul className="flex flex-col gap-2">
            {inherited.map((r) => (
              <ReferenceRow key={r.id} reference={r} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap gap-2">
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(Object.keys(KIND_LABEL) as ReferenceKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  kind === k ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className={`${inputClass} min-w-40 flex-1 py-1.5`}
          />
        </div>
        {kind === 'snippet' ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            placeholder={KIND_PLACEHOLDER[kind]}
            className={`${inputClass} font-mono text-xs`}
          />
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            placeholder={KIND_PLACEHOLDER[kind]}
            className={inputClass}
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!value.trim()}
          className="self-end rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/15 disabled:opacity-40"
        >
          Add reference
        </button>
      </div>
    </div>
  )
}

function ReferenceRow({
  reference: r,
  onToggle,
  onRemove,
}: {
  reference: Reference
  onToggle?: () => void
  onRemove?: () => void
}) {
  return (
    <li className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <span className="mt-0.5 shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {KIND_LABEL[r.kind]}
      </span>
      <div className="min-w-0 flex-1">
        {r.label && <div className="text-sm font-medium text-slate-200">{r.label}</div>}
        {r.kind === 'url' ? (
          <a
            href={r.value}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm text-indigo-300 hover:underline"
          >
            {r.value}
          </a>
        ) : r.kind === 'path' ? (
          <div className="truncate font-mono text-xs text-slate-300">{r.value}</div>
        ) : (
          <pre className="max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-xs text-slate-400">
            {r.value}
          </pre>
        )}
      </div>
      <label
        className={`flex shrink-0 items-center gap-1.5 text-xs ${onToggle ? 'cursor-pointer text-slate-400' : 'text-slate-600'}`}
      >
        <input
          type="checkbox"
          checked={r.includeInContext}
          onChange={onToggle}
          disabled={!onToggle}
          className="accent-violet-400"
        />
        Send to Claude
      </label>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove"
          className="shrink-0 rounded p-0.5 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 6l8 8M14 6l-8 8" />
          </svg>
        </button>
      )}
    </li>
  )
}
