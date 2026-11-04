import { useState } from 'react'
import type { PlanStep, PlanStepStatus } from '../lib/types'
import { uid } from '../lib/storage'

const NEXT_STATUS: Record<PlanStepStatus, PlanStepStatus> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo',
}

/** Matches a markdown checklist line, e.g. "- [ ] write tests". */
const CHECKLIST_RE = /^\s*[-*] \[([ xX])\] (.+)$/

type Props = {
  steps: PlanStep[]
  onChange: (steps: PlanStep[]) => void
  /** Offer to copy checklist lines from notes when the plan is empty. */
  notes?: string
  compact?: boolean
}

export function PlanEditor({ steps, onChange, notes = '', compact = false }: Props) {
  const [draft, setDraft] = useState('')

  const update = (id: string, patch: Partial<PlanStep>) =>
    onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const add = () => {
    const text = draft.trim()
    if (!text) return
    onChange([...steps, { id: uid(), text, status: 'todo', owner: 'me' }])
    setDraft('')
  }

  const checklist = notes
    .split('\n')
    .map((l) => l.match(CHECKLIST_RE))
    .filter((m): m is RegExpMatchArray => m != null)

  const importFromNotes = () =>
    onChange(
      checklist.map((m) => ({
        id: uid(),
        text: m[2].trim(),
        status: m[1] === ' ' ? 'todo' : 'done',
        owner: 'me',
      })),
    )

  const done = steps.filter((s) => s.status === 'done').length

  return (
    <div className="flex flex-col gap-2">
      {steps.length > 0 && !compact && (
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400/70 transition-all"
              style={{ width: `${(done / steps.length) * 100}%` }}
            />
          </div>
          {done}/{steps.length} done
        </div>
      )}

      <ol className="flex flex-col gap-1">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/[0.03]"
          >
            <button
              type="button"
              onClick={() => update(step.id, { status: NEXT_STATUS[step.status] })}
              title={`Status: ${step.status} (click to change)`}
              className="shrink-0"
            >
              <StatusIcon status={step.status} />
            </button>
            <input
              value={step.text}
              onChange={(e) => update(step.id, { text: e.target.value })}
              onBlur={(e) => {
                if (!e.target.value.trim()) onChange(steps.filter((s) => s.id !== step.id))
              }}
              className={`min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-sm outline-none focus:bg-white/5 ${
                step.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-100'
              }`}
            />
            <button
              type="button"
              onClick={() => update(step.id, { owner: step.owner === 'me' ? 'claude' : 'me' })}
              title="Who does this step (click to switch)"
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                step.owner === 'claude'
                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                  : 'border-white/10 text-slate-400'
              }`}
            >
              {step.owner === 'claude' ? 'Claude' : 'Me'}
            </button>
            {!compact && (
              <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                <IconButton title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                  <path d="M10 6l-4 4h8l-4-4z" />
                </IconButton>
                <IconButton
                  title="Move down"
                  onClick={() => move(i, 1)}
                  disabled={i === steps.length - 1}
                >
                  <path d="M10 14l4-4H6l4 4z" />
                </IconButton>
                <IconButton
                  title="Remove step"
                  onClick={() => onChange(steps.filter((s) => s.id !== step.id))}
                >
                  <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.8" />
                </IconButton>
              </div>
            )}
          </li>
        ))}
      </ol>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
        placeholder={steps.length ? 'Add a step…' : 'Add the first step, or ask Claude to plan it'}
        className="rounded-lg border border-dashed border-white/10 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
      />

      {steps.length === 0 && checklist.length > 0 && (
        <button
          type="button"
          onClick={importFromNotes}
          className="self-start text-xs text-indigo-300 hover:text-indigo-200"
        >
          Copy {checklist.length} checklist item{checklist.length === 1 ? '' : 's'} from notes
        </button>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: PlanStepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/80 text-white">
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 10l3 3 7-7" />
        </svg>
      </span>
    )
  }
  if (status === 'doing') {
    return (
      <span className="block h-4 w-4 rounded-full border-2 border-amber-400 bg-[conic-gradient(var(--color-amber-400)_50%,transparent_0)]" />
    )
  }
  return <span className="block h-4 w-4 rounded-full border-2 border-slate-500" />
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
        {children}
      </svg>
    </button>
  )
}
