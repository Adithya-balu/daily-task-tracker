import { useEffect, useState } from 'react'
import type { ClaudeConfig, Project } from '../lib/types'
import { resolveProjectConfig } from '../lib/claude'
import { ClaudeSettingsFields, WorkingDirInput } from './ClaudeSettingsFields'
import { ReferencesPanel } from './ReferencesPanel'
import { FieldLabel, inputClass } from './ui'

type Props = {
  projects: Project[]
  taskCounts: Record<string, number>
  onAdd: (name: string) => Project
  onUpdate: (id: string, patch: Partial<Project>) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/** Projects hold the working folder, Claude defaults and shared references for their tasks. */
export function ProjectsDialog({ projects, taskCounts, onAdd, onUpdate, onDelete, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null)
  const selected = projects.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateClaude = (p: Project, patch: Partial<ClaudeConfig>) => {
    const claude: ClaudeConfig = { ...p.claude, ...patch }
    for (const k of Object.keys(claude) as (keyof ClaudeConfig)[]) {
      if (claude[k] === undefined) delete claude[k]
    }
    onUpdate(p.id, { claude })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="animate-pop-in my-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Project list */}
        <div className="flex shrink-0 flex-col gap-1 border-b border-white/10 p-4 sm:w-56 sm:border-b-0 sm:border-r">
          <h2 className="mb-2 px-2 text-lg font-semibold text-white">Projects</h2>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition ${
                p.id === selectedId ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="truncate">{p.name}</span>
              <span className="text-xs text-slate-500">{taskCounts[p.id] ?? 0}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedId(onAdd('New project').id)}
            className="mt-1 rounded-lg px-2 py-1.5 text-left text-sm text-indigo-300 hover:text-indigo-200"
          >
            + New project
          </button>
        </div>

        {/* Editor */}
        <div className="flex max-h-[80vh] min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-5">
            {!selected ? (
              <div className="py-16 text-center text-sm text-slate-500">
                Create a project to share a working folder, Claude settings and references across
                tasks.
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <label>
                  <FieldLabel>Name</FieldLabel>
                  <input
                    value={selected.name}
                    onChange={(e) => onUpdate(selected.id, { name: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <div>
                  <FieldLabel>Working folder</FieldLabel>
                  <WorkingDirInput
                    value={selected.workingDir}
                    placeholder="/Users/you/code/my-repo"
                    onChange={(v) => onUpdate(selected.id, { workingDir: v })}
                  />
                </div>
                <label>
                  <FieldLabel>Rules for Claude</FieldLabel>
                  <textarea
                    value={selected.rules}
                    onChange={(e) => onUpdate(selected.id, { rules: e.target.value })}
                    rows={3}
                    placeholder="e.g. Run npm test before finishing. Don't commit. Follow the existing code style."
                    className={inputClass}
                  />
                </label>
                <label>
                  <FieldLabel>Test &amp; lint command</FieldLabel>
                  <input
                    value={selected.ciCommand ?? ''}
                    onChange={(e) => onUpdate(selected.id, { ciCommand: e.target.value })}
                    placeholder="e.g. npm test && npm run lint"
                    className={`${inputClass} font-mono`}
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Run by workflow CI stages in the working folder. Pass = exit code 0.
                  </span>
                </label>
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-300">Claude defaults</div>
                  <ClaudeSettingsFields
                    value={selected.claude}
                    inherited={resolveProjectConfig(null)}
                    inheritLabel="Default"
                    onChange={(patch) => updateClaude(selected, patch)}
                    showWorkingDir={false}
                  />
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-300">Shared references</div>
                  <ReferencesPanel
                    references={selected.references}
                    onChange={(references) => onUpdate(selected.id, { references })}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/10 p-4">
            {selected ? (
              <button
                type="button"
                onClick={() => {
                  const count = taskCounts[selected.id] ?? 0
                  if (
                    count === 0 ||
                    window.confirm(`Delete "${selected.name}"? Its ${count} task(s) will keep their data but lose the project.`)
                  ) {
                    onDelete(selected.id)
                    setSelectedId(projects.find((p) => p.id !== selected.id)?.id ?? null)
                  }
                }}
                className="rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:text-rose-400"
              >
                Delete project
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
