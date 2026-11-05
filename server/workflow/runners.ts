import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { WorkflowRunMap } from '../../src/lib/workflowTypes'
import { resolveDir, type AgentHub } from '../agents'
import type { Store } from '../store'
import { loadWorkflowConfig } from './config'
import { WorkflowEngine, type CommandResult, type EnginePorts } from './engine'
import { agentEnv, commandEnv } from './env'
import * as git from './git'

/** Safety net so a hung test command can't stall a workflow forever. */
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000
const COMMAND_OUTPUT_KEPT = 64 * 1024

/** The engine wired to the real Claude CLI, shell, git and data/ store. */
export function createWorkflowEngine(root: string, store: Store, hub: AgentHub): WorkflowEngine {
  const workflowsDir = path.join(root, 'workflows')
  const ports: EnginePorts = {
    loadConfig: () => loadWorkflowConfig(workflowsDir),

    runAgent: async (req) => {
      const { ticket, mode } = req
      const { runId, done } = hub.runHeadless(req.taskId, {
        prompt: req.prompt,
        cwd: req.cwd,
        title: `${ticket.title} · ${req.stage}`,
        permissionMode: mode.permissionMode,
        allowedTools: mode.allowedTools ?? [],
        disallowedTools: mode.disallowedTools ?? [],
        jsonSchema: JSON.stringify(mode.outputSchema),
        model: ticket.model,
        effort: ticket.effort,
        maxBudgetUsd: req.maxBudgetUsd,
        appendSystemPrompt: req.systemPrompt,
        addDirs: ticket.addDirs,
        resumeSessionId: req.resumeSessionId,
        env: agentEnv(),
      })
      req.onStart(runId)
      const onAbort = () => hub.stopRun(runId)
      req.signal.addEventListener('abort', onAbort)
      try {
        const r = await done
        return {
          runId,
          sessionId: r.sessionId,
          output: r.structured,
          error: r.isError ? (r.error ?? 'Run failed.') : null,
          usage: r.usage,
          costUsd: r.costUsd,
        }
      } finally {
        req.signal.removeEventListener('abort', onAbort)
      }
    },

    runCommand: (cmd, cwd, signal) => runShell(cmd, cwd, signal),

    resolveDir: (dir) => {
      const resolved = resolveDir(dir)
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`Working folder not found: ${resolved}`)
      }
      return resolved
    },

    git,
    writeDiff: (taskId, recordId, patch) => fs.writeFileSync(store.workflowDiffPath(taskId, recordId), patch),
    loadRuns: () => store.read<WorkflowRunMap>('workflowRuns', {}),
    saveRuns: (runs) => store.write('workflowRuns', runs),
    emit: (taskId, runs) => hub.broadcast({ type: 'workflow', taskId, runs }),
    emitEffect: (effect) => hub.emitEffect(effect),
    now: () => Date.now(),
    newId: () => randomUUID(),
  }
  const engine = new WorkflowEngine(ports)
  hub.setRunGuard((taskId) => engine.guard(taskId))
  return engine
}

/** Runs a shell command; exit code 0 means pass. Output is stdout+stderr. */
function runShell(cmd: string, cwd: string, signal: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], { cwd, env: commandEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let note = ''
    const append = (d: Buffer) => {
      output = (output + d.toString()).slice(-COMMAND_OUTPUT_KEPT)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      note = `\n[stopped after ${COMMAND_TIMEOUT_MS / 60000} minutes]`
      child.kill('SIGTERM')
    }, COMMAND_TIMEOUT_MS)
    const onAbort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', onAbort)
    child.on('error', (err) => {
      note += `\n${err.message}`
    })
    child.on('close', (code, sig) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({ exitCode: code ?? 1, output: output + note + (sig && !note ? `\n[killed by ${sig}]` : '') })
    })
  })
}
