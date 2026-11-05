import { useCallback, useMemo, useRef, useState } from 'react'
import { useAiConfig } from '../../hooks/useAiConfig'
import { blankWorkflow } from '../../lib/workflowEdit'
import type { AgentDef, WorkflowDef } from '../../lib/workflowTypes'
import { EntryList, NewEntryForm } from './common'
import { WorkflowEditor } from './WorkflowEditor'

type Tab = 'workflows' | 'agents'

/** An entry being created; it exists only in the editor until saved. */
type Draft = { id: string; def: WorkflowDef }

/** The AI view: edit workflows and the agents they run. */
export function AiSection({ revision }: { revision: number }) {
  const ai = useAiConfig(revision)
  const [tab, setTab] = useState<Tab>('workflows')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ copyOf?: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d
  }, [])

  /** Runs `fn` unless there are unsaved edits you don't want to lose. */
  const guard = (fn: () => void) => {
    if (dirty.current && !window.confirm('Discard your unsaved changes?')) return
    dirty.current = false
    setError(null)
    fn()
  }

  const removeEntry = (kind: 'workflows' | 'agents', id: string, after: () => void) => {
    setError(null)
    ai.remove(kind, id)
      .then(after)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const config = ai.config
  /** Valid agents, which is what workflows are checked against. */
  const agents = useMemo(() => {
    const out: Record<string, AgentDef> = {}
    for (const a of config?.agents ?? []) if (a.def && a.errors.length === 0) out[a.id] = a.def
    return out
  }, [config])

  if (!config) {
    return (
      <p className="text-sm text-slate-500">{ai.loadError ? `Couldn't load: ${ai.loadError}` : 'Loading…'}</p>
    )
  }

  const workflows = config.workflows
  const current = workflows.find((w) => w.id === selected) ?? (draft || creating ? undefined : workflows[0])

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-white/10" role="tablist">
        {(['workflows', 'agents'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() =>
              guard(() => {
                setTab(t)
                setSelected(null)
                setCreating(null)
                setDraft(null)
              })
            }
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition ${
              tab === t ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 whitespace-pre-wrap rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {tab === 'workflows' && (
        <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
          <EntryList
            items={workflows.map((w) => ({
              id: w.id,
              source: w.source,
              version: w.def?.version ?? null,
              invalid: w.errors.length > 0,
              hint: w.def ? `${Object.keys(w.def.stages ?? {}).length} stages` : undefined,
            }))}
            selected={draft?.id ?? (creating ? null : (current?.id ?? null))}
            onSelect={(id) =>
              guard(() => {
                setSelected(id)
                setCreating(null)
                setDraft(null)
              })
            }
            onNew={() =>
              guard(() => {
                setCreating({})
                setDraft(null)
              })
            }
            newLabel="New workflow"
          />

          <div className="min-w-0">
            {creating ? (
              <NewEntryForm
                key={creating.copyOf ?? 'new'}
                kind="workflow"
                taken={workflows.map((w) => w.id)}
                starters={[
                  { value: '', label: 'Blank' },
                  ...workflows.filter((w) => w.def).map((w) => ({ value: w.id, label: `Copy of ${w.id}` })),
                ]}
                initialStarter={creating.copyOf}
                onCancel={() => setCreating(null)}
                onCreate={(id, from) => {
                  const source = workflows.find((w) => w.id === from)?.def
                  const def = source ? { ...structuredClone(source), workflow: id, version: 1 } : blankWorkflow(id)
                  setDraft({ id, def })
                  setCreating(null)
                }}
              />
            ) : draft ? (
              <WorkflowEditor
                key={`new:${draft.id}`}
                id={draft.id}
                source={null}
                initial={draft.def}
                agents={agents}
                onDirtyChange={onDirtyChange}
                onSave={async (def) => {
                  await ai.saveWorkflow(draft.id, def, null)
                  dirty.current = false
                  setSelected(draft.id)
                  setDraft(null)
                }}
                onCancelNew={() => {
                  dirty.current = false
                  setDraft(null)
                }}
                onDuplicate={() => {}}
                onRemove={() => {}}
              />
            ) : current?.def ? (
              <WorkflowEditor
                key={`${current.id}:${current.def.version}:${current.source}`}
                id={current.id}
                source={current.source}
                initial={current.def}
                agents={agents}
                onDirtyChange={onDirtyChange}
                onSave={async (def, baseVersion) => {
                  await ai.saveWorkflow(current.id, def, baseVersion)
                  dirty.current = false
                }}
                onCancelNew={() => {}}
                onDuplicate={() => setCreating({ copyOf: current.id })}
                onRemove={() => {
                  const what =
                    current.source === 'modified'
                      ? `Reset "${current.id}" to its built-in default? Your edits will be lost.`
                      : `Delete "${current.id}"? Tasks using it will need another workflow; past runs keep their copy.`
                  if (window.confirm(what)) {
                    removeEntry('workflows', current.id, () => {
                      if (current.source === 'custom') setSelected(null)
                    })
                  }
                }}
              />
            ) : current ? (
              <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4 text-sm text-rose-200">
                This file can't be read: {current.errors[0]}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No workflows yet.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'agents' && <p className="text-sm text-slate-500">Agent editing comes in the next step.</p>}
    </div>
  )
}
