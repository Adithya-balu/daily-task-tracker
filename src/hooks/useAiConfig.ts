import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AgentDef, AiAgentEntry, AiConfig, AiWorkflowEntry, WorkflowDef } from '../lib/workflowTypes'

/**
 * Workflows and agents for the AI section. Reloads whenever `revision`
 * changes, i.e. after an edit here or in another tab (SSE 'ai' event).
 */
export function useAiConfig(revision: number) {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(
    () =>
      api<AiConfig>('/ai')
        .then((c) => {
          setConfig(c)
          setLoadError(null)
        })
        .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err))),
    [],
  )

  useEffect(() => {
    void reload()
  }, [reload, revision])

  const saveWorkflow = useCallback(
    async (id: string, def: WorkflowDef, baseVersion: number | null) => {
      const saved = await api<AiWorkflowEntry>(`/ai/workflows/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { def, baseVersion },
      })
      await reload()
      return saved
    },
    [reload],
  )

  const saveAgent = useCallback(
    async (id: string, def: AgentDef, rolePrompt: string, baseVersion: number | null) => {
      const saved = await api<AiAgentEntry>(`/ai/agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { def, rolePrompt, baseVersion },
      })
      await reload()
      return saved
    },
    [reload],
  )

  /** Deletes a custom entry or resets a modified built-in. */
  const remove = useCallback(async (kind: 'workflows' | 'agents', id: string) => {
    setConfig(await api<AiConfig>(`/ai/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  }, [])

  return { config, loadError, reload, saveWorkflow, saveAgent, remove }
}

export type UseAiConfig = ReturnType<typeof useAiConfig>
