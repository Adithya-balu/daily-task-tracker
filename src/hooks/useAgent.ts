import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMap, AgentStatus, Effect, RunRequest, ServerEvent } from '../lib/agentTypes'
import { api, type LiveState } from '../lib/api'
import { playChime, sendNotification } from '../lib/notify'
import type {
  Ticket,
  WorkflowRun,
  WorkflowRunMap,
  WorkflowRunStatus,
  WorkflowSummary,
} from '../lib/workflowTypes'

const NOTIFY_ON: Partial<Record<AgentStatus, string>> = {
  awaiting_review: 'Plan ready for review',
  done: 'Claude finished',
  failed: 'Claude run failed',
}

const NOTIFY_ON_WORKFLOW: Partial<Record<WorkflowRunStatus, string>> = {
  awaiting_gate: 'Workflow waiting for your approval',
  escalated: 'Workflow needs you',
  completed: 'Workflow finished',
}

/**
 * Live Claude state for every task, kept in sync over the server's event
 * stream: interactive runs (`agents`) and workflow runs (`workflowRuns`).
 * Effects (resume notes, log entries, plans) are handed to `onEffect`.
 */
export function useAgent(
  initialAgents: AgentMap,
  initialWorkflowRuns: WorkflowRunMap,
  onEffect: (effect: Effect) => void,
  titleOf: (taskId: string) => string | undefined,
) {
  const [agents, setAgents] = useState<AgentMap>(initialAgents)
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunMap>(initialWorkflowRuns)
  const workflowRunsRef = useRef(workflowRuns)
  workflowRunsRef.current = workflowRuns
  const [connected, setConnected] = useState(true)
  /** Bumped when workflows or agents are edited (here or in another tab). */
  const [aiRevision, setAiRevision] = useState(0)
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
          setWorkflowRuns(live.workflowRuns)
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
      if (event.type === 'ai') {
        setAiRevision((n) => n + 1)
        return
      }
      if (event.type === 'workflow') {
        const before = workflowRunsRef.current[event.taskId]?.[0]
        const after = event.runs[0]
        const label = after && NOTIFY_ON_WORKFLOW[after.status]
        if (label && before?.id === after.id && before.status !== after.status) {
          playChime()
          sendNotification(label, titleOfRef.current(event.taskId) ?? '')
        }
        setWorkflowRuns((all) => ({ ...all, [event.taskId]: event.runs }))
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

  /** Applies a run the server returned right away, ahead of its event. */
  const workflowPost = useCallback(
    async (taskId: string, op: string, body?: unknown) => {
      const run = (await post(taskId, `workflow/${op}`, body)) as WorkflowRun
      setWorkflowRuns((all) => {
        const rest = (all[taskId] ?? []).filter((r) => r.id !== run.id)
        return { ...all, [taskId]: [run, ...rest] }
      })
      return run
    },
    [post],
  )
  const listWorkflows = useCallback(() => api<WorkflowSummary[]>('/workflows'), [])
  const startWorkflow = useCallback(
    (taskId: string, workflowId: string, ticket: Ticket) => workflowPost(taskId, 'start', { workflowId, ticket }),
    [workflowPost],
  )
  const decideGate = useCallback(
    (taskId: string, decision: 'approved' | 'rejected', comment: string) =>
      workflowPost(taskId, 'gate', { decision, comment }),
    [workflowPost],
  )
  const retryWorkflow = useCallback(
    (taskId: string, stage: string) => workflowPost(taskId, 'retry', { stage }),
    [workflowPost],
  )
  const cancelWorkflow = useCallback((taskId: string) => workflowPost(taskId, 'cancel'), [workflowPost])
  /** Stops any run and removes the task's Claude state (used when deleting a task). */
  const forget = useCallback((taskId: string) => {
    setAgents((all) => {
      const next = { ...all }
      delete next[taskId]
      return next
    })
    setWorkflowRuns((all) => {
      const next = { ...all }
      delete next[taskId]
      return next
    })
    return api(`/tasks/${encodeURIComponent(taskId)}/agent`, { method: 'DELETE' })
  }, [])

  return {
    agents,
    workflowRuns,
    connected,
    aiRevision,
    run,
    stop,
    acknowledge,
    openTerminal,
    openVSCode,
    markBack,
    forget,
    listWorkflows,
    startWorkflow,
    decideGate,
    retryWorkflow,
    cancelWorkflow,
  }
}

export type UseAgent = ReturnType<typeof useAgent>
