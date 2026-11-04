import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMap, AgentStatus, Effect, RunRequest, ServerEvent } from '../lib/agentTypes'
import { api, type LiveState } from '../lib/api'
import { playChime, sendNotification } from '../lib/notify'

const NOTIFY_ON: Partial<Record<AgentStatus, string>> = {
  awaiting_review: 'Plan ready for review',
  done: 'Claude finished',
  failed: 'Claude run failed',
}

/**
 * Live Claude state for every task, kept in sync over the server's event
 * stream. Effects (resume notes, log entries, plans) are handed to `onEffect`.
 */
export function useAgent(
  initialAgents: AgentMap,
  onEffect: (effect: Effect) => void,
  titleOf: (taskId: string) => string | undefined,
) {
  const [agents, setAgents] = useState<AgentMap>(initialAgents)
  const [connected, setConnected] = useState(true)
  const onEffectRef = useRef(onEffect)
  onEffectRef.current = onEffect
  const titleOfRef = useRef(titleOf)
  titleOfRef.current = titleOf
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onopen = () => {
      setConnected(true)
      // Catch up on anything emitted while we weren't listening.
      api<LiveState>('/live')
        .then((live) => {
          setAgents(live.agents)
          live.effects.forEach((e) => onEffectRef.current(e))
        })
        .catch(() => {})
    }
    es.onerror = () => setConnected(false)
    es.onmessage = (m) => {
      const event = JSON.parse(m.data) as ServerEvent
      if (event.type === 'effect') {
        onEffectRef.current(event.effect)
        return
      }
      const prev = agentsRef.current[event.taskId]
      const label = NOTIFY_ON[event.state.status]
      if (label && prev?.status === 'running') {
        playChime()
        sendNotification(label, titleOfRef.current(event.taskId) ?? '')
      }
      setAgents((all) => ({ ...all, [event.taskId]: event.state }))
    }
    return () => es.close()
  }, [])

  const post = useCallback(
    (taskId: string, action: string, body?: unknown) =>
      api(`/tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST', body: body ?? {} }),
    [],
  )

  const run = useCallback((taskId: string, req: RunRequest) => post(taskId, 'run', req), [post])
  const stop = useCallback((taskId: string) => post(taskId, 'stop'), [post])
  const acknowledge = useCallback((taskId: string) => post(taskId, 'ack'), [post])
  const openTerminal = useCallback((taskId: string) => post(taskId, 'terminal'), [post])
  const openVSCode = useCallback(
    (taskId: string, prompt: string) => post(taskId, 'vscode', { prompt }),
    [post],
  )
  const markBack = useCallback((taskId: string) => post(taskId, 'terminal-closed'), [post])
  /** Stops any run and removes the task's Claude state (used when deleting a task). */
  const forget = useCallback((taskId: string) => {
    setAgents((all) => {
      const next = { ...all }
      delete next[taskId]
      return next
    })
    return api(`/tasks/${encodeURIComponent(taskId)}/agent`, { method: 'DELETE' })
  }, [])

  return { agents, connected, run, stop, acknowledge, openTerminal, openVSCode, markBack, forget }
}

export type UseAgent = ReturnType<typeof useAgent>
