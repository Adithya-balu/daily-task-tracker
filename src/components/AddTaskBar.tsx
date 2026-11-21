import { forwardRef, useState } from 'react'
import type { Priority, Project } from '../lib/types'
import { PREF_KEYS, loadPref, savePref } from '../lib/storage'
import { PRIORITY_STYLES } from './ui'

const PRIORITIES: Priority[] = ['high', 'medium', 'low']

type Props = {
  projects: Project[]
  onAdd: (title: string, priority: Priority, projectId: string | null) => void
}

export const AddTaskBar = forwardRef<HTMLInputElement, Props>(function AddTaskBar(
  { projects, onAdd },
  ref,
) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  // Remember the last project used; ignore it if that project was deleted.
  const [projectId, setProjectId] = useState<string | null>(() => loadPref(PREF_KEYS.lastProjectId))
  const effectiveProjectId = projects.some((p) => p.id === projectId) ? projectId : null

  const submit = () => {
    const t = title.trim()
    if (!t) return
    onAdd(t, priority, effectiveProjectId)
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
      <div className="flex flex-wrap items-center gap-2">
        {projects.length > 0 && (
          <select
            value={effectiveProjectId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              setProjectId(id)
              savePref(PREF_KEYS.lastProjectId, id)
            }}
            className="max-w-40 rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-slate-300 outline-none"
            title="Project"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
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
