import { forwardRef, useState } from 'react'
import type { Priority } from '../lib/types'
import { PRIORITY_STYLES } from './ui'

const PRIORITIES: Priority[] = ['high', 'medium', 'low']

type Props = {
  onAdd: (title: string, priority: Priority) => void
}

export const AddTaskBar = forwardRef<HTMLInputElement, Props>(function AddTaskBar(
  { onAdd },
  ref,
) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')

  const submit = () => {
    const t = title.trim()
    if (!t) return
    onAdd(t, priority)
    setTitle('')
    setPriority('medium')
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur sm:flex-row sm:items-center">
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="What needs doing? Add a task..."
        className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 outline-none focus:bg-white/5"
      />
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-white/10">
          {PRIORITIES.map((p) => {
            const active = priority === p
            const s = PRIORITY_STYLES[p]
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                <span className="capitalize">{p}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={submit}
          className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-95"
        >
          Add
        </button>
      </div>
    </div>
  )
})
