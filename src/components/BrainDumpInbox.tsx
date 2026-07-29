import { memo, useState } from 'react'
import type { BrainDumpItem, Priority } from '../lib/types'

type Props = {
  items: BrainDumpItem[]
  onAdd: (text: string) => void
  onRemove: (id: string) => void
  onPromote: (id: string, priority: Priority) => void
}

/**
 * A quick capture inbox so a stray thought doesn't pull you off the current task.
 * Jot it, keep working, triage later into a real task.
 */
export const BrainDumpInbox = memo(function BrainDumpInbox({
  items,
  onAdd,
  onRemove,
  onPromote,
}: Props) {
  const [text, setText] = useState('')

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-1 text-sm font-semibold text-slate-200">Brain dump</div>
      <p className="mb-3 text-xs text-slate-500">
        Distracting thought? Park it here without leaving your task.
      </p>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Jot it down..."
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
        />
        <button
          onClick={submit}
          className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/15 active:scale-95"
        >
          Add
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-slate-200">{item.text}</span>
              <button
                onClick={() => onPromote(item.id, 'medium')}
                title="Turn into a task"
                className="rounded px-2 py-0.5 text-xs font-medium text-indigo-300 opacity-0 transition hover:bg-indigo-500/15 group-hover:opacity-100"
              >
                To task
              </button>
              <button
                onClick={() => onRemove(item.id)}
                title="Dismiss"
                className="rounded px-1.5 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
