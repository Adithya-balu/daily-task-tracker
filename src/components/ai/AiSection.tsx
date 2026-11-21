import { useCallback, useMemo, useRef, useState } from 'react'
import { useAiConfig } from '../../hooks/useAiConfig'
import { STARTER_AGENTS } from '../../lib/agentTemplates'
import { blankWorkflow } from '../../lib/workflowEdit'
import type { AgentDef, WorkflowDef } from '../../lib/workflowTypes'
import { validateWorkflow } from '../../lib/workflowValidate'
import { AgentEditor } from './AgentEditor'
import { EntryList, NewEntryForm } from './common'
import { WorkflowEditor } from './WorkflowEditor'

type Tab = 'workflows' | 'agents'

/** An entry being created; it exists only in the editor until saved. */
type Draft = { id: string; def: WorkflowDef }
type AgentDraft = { id: string; def: AgentDef; rolePrompt: string }

/** The AI view: edit workflows and the agents they run. */
export function AiSection({ revision }: { revision: number }) {
  const ai = useAiConfig(revision)
  const [tab, setTab] = useState<Tab>('workflows')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ copyOf?: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null)
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

  /** What saving `def` as agent `id` would break in workflows that are valid now. */
  const workflowErrorsFor = useCallback(
    (id: string) => (def: AgentDef) =>
      (config?.workflows ?? [])
        .filter((w) => w.def && w.errors.length === 0)
        .flatMap((w) => validateWorkflow(w.def, { ...agents, [id]: def }).map((e) => `${w.id}: ${e}`)),
    [config, agents],
  )

  if (!config) {
    return (
      <p className="text-sm text-slate-500">{ai.loadError ? `Couldn't load: ${ai.loadError}` : 'Loading…'}</p>
    )
  }

  const workflows = config.workflows
  const current = workflows.find((w) => w.id === selected) ?? (draft || creating ? undefined : workflows[0])
  const currentAgent =
    config.agents.find((a) => a.id === selected) ?? (agentDraft || creating ? undefined : config.agents[0])

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
                setAgentDraft(null)
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

      {tab === 'agents' && (
        <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
          <EntryList
            items={config.agents.map((a) => ({
              id: a.id,
              source: a.source,
              version: a.def?.version ?? null,
              invalid: a.errors.length > 0,
              hint: a.usedBy.length ? `in ${a.usedBy.length} workflow${a.usedBy.length === 1 ? '' : 's'}` : 'unused',
            }))}
            selected={agentDraft?.id ?? (creating ? null : (currentAgent?.id ?? null))}
            onSelect={(id) =>
              guard(() => {
                setSelected(id)
                setCreating(null)
                setAgentDraft(null)
              })
            }
            onNew={() =>
              guard(() => {
                setCreating({})
                setAgentDraft(null)
              })
            }
            newLabel="New agent"
          />

          <div className="min-w-0">
            {creating ? (
              <NewEntryForm
                key={creating.copyOf ?? 'new'}
                kind="agent"
                taken={config.agents.map((a) => a.id)}
                starters={[
                  ...Object.entries(STARTER_AGENTS).map(([k, st]) => ({ value: `starter:${k}`, label: `${st.label}: ${st.description}` })),
                  ...config.agents.filter((a) => a.def).map((a) => ({ value: a.id, label: `Copy of ${a.id}` })),
                ]}
                initialStarter={creating.copyOf}
                onCancel={() => setCreating(null)}
                onCreate={(id, from) => {
                  const starter = from.startsWith('starter:') ? STARTER_AGENTS[from.slice(8) as keyof typeof STARTER_AGENTS] : null
                  const copy = config.agents.find((a) => a.id === from)
                  const made = starter
                    ? starter.build(id)
                    : { def: { ...structuredClone(copy!.def!), agent: id, prompt: `${id}.md`, version: 1 }, rolePrompt: copy!.rolePrompt }
                  setAgentDraft({ id, ...made })
                  setCreating(null)
                }}
              />
            ) : agentDraft ? (
              <AgentEditor
                key={`new:${agentDraft.id}`}
                id={agentDraft.id}
                source={null}
                initial={agentDraft.def}
                initialPrompt={agentDraft.rolePrompt}
                usedBy={[]}
                workflowErrors={workflowErrorsFor(agentDraft.id)}
                onDirtyChange={onDirtyChange}
                onSave={async (def, rolePrompt) => {
                  await ai.saveAgent(agentDraft.id, def, rolePrompt, null)
                  dirty.current = false
                  setSelected(agentDraft.id)
                  setAgentDraft(null)
                }}
                onCancelNew={() => {
                  dirty.current = false
                  setAgentDraft(null)
                }}
                onDuplicate={() => {}}
                onRemove={() => {}}
              />
            ) : currentAgent?.def ? (
              <AgentEditor
                key={`${currentAgent.id}:${currentAgent.def.version ?? 0}:${currentAgent.source}`}
                id={currentAgent.id}
                source={currentAgent.source}
                initial={currentAgent.def}
                initialPrompt={currentAgent.rolePrompt}
                usedBy={currentAgent.usedBy}
                workflowErrors={workflowErrorsFor(currentAgent.id)}
                onDirtyChange={onDirtyChange}
                onSave={async (def, rolePrompt, baseVersion) => {
                  await ai.saveAgent(currentAgent.id, def, rolePrompt, baseVersion)
                  dirty.current = false
                }}
                onCancelNew={() => {}}
                onDuplicate={() => setCreating({ copyOf: currentAgent.id })}
                onRemove={() => {
                  const what =
                    currentAgent.source === 'modified'
                      ? `Reset "${currentAgent.id}" to its built-in default? Your edits will be lost.`
                      : `Delete agent "${currentAgent.id}"?`
                  if (window.confirm(what)) {
                    removeEntry('agents', currentAgent.id, () => {
                      if (currentAgent.source === 'custom') setSelected(null)
                    })
                  }
                }}
              />
            ) : currentAgent ? (
              <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4 text-sm text-rose-200">
                This agent can't be read: {currentAgent.errors[0]}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No agents yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
