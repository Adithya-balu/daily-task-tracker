import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyUsage, totalTokens, type RunSummary } from '../src/lib/agentTypes'
import { AgentHub, HttpError, claudeBin } from './agents'

/** Wraps a value in single quotes for a POSIX shell. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Escapes a value for use inside an AppleScript double-quoted string. */
function asQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Opens Terminal.app on the task's Claude session. When Claude exits, the
 * trailing curl tells the app the terminal is closed so the task unlocks.
 */
export function openInTerminal(hub: AgentHub, taskId: string, origin: string): Promise<void> {
  const agent = hub.getAgents()[taskId]
  if (!agent?.sessionId || !agent.cwd) {
    throw new HttpError(400, 'Run Claude on this task once before opening it in Terminal.')
  }
  if (agent.status === 'running') throw new HttpError(409, 'Stop the running task first.')
  if (agent.status === 'in_terminal') throw new HttpError(409, 'This task is already open in Terminal.')

  const closeUrl = `${origin}/api/tasks/${encodeURIComponent(taskId)}/terminal-closed`
  const command = [
    `cd ${shQuote(agent.cwd)}`,
    `&& ${shQuote(claudeBin())} --resume ${shQuote(agent.sessionId)};`,
    `curl -s -X POST -H 'X-Daily-Focus: 1' ${shQuote(closeUrl)} >/dev/null`,
  ].join(' ')

  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${asQuote(command)}`, '-e', 'end tell'],
      (err) => {
        if (err) {
          reject(new HttpError(500, `Could not open Terminal: ${err.message}`))
          return
        }
        hub.setAgent(taskId, {
          status: 'in_terminal',
          openedIn: 'terminal',
          terminalOpenedAt: Date.now(),
          error: null,
        })
        resolve()
      },
    )
  })
}

/** VS Code's own CLI. `code` on PATH may belong to another editor (e.g. Cursor). */
function vscodeCli(): string | null {
  const candidates = [
    process.env.VSCODE_CLI,
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'),
  ].filter((p): p is string => Boolean(p))
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

/** Finds the VS Code window whose title ends with the folder name, via `code --status`. */
async function findWindowId(cli: string, folder: string): Promise<string | null> {
  const name = path.basename(folder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`window \\[(\\d+)\\] \\((?:.* — )?${name}\\)\\s*$`, 'm')
  for (let i = 0; i < 15; i++) {
    const status = await run(cli, ['--status']).catch(() => '')
    const m = status.match(re)
    if (m) return m[1]
    await new Promise((r) => setTimeout(r, 1000))
  }
  return null
}

/**
 * Hands the task over to a new chat in the Claude Code extension's panel in
 * VS Code. The panel doesn't list sessions started headlessly (`claude -p`),
 * so it can't resume the app's session; instead the new chat gets the task's
 * context plus the path to the earlier session's transcript. Uses the
 * extension's undocumented `open?prompt=` link, which may change in updates.
 */
export async function openInVSCode(hub: AgentHub, taskId: string, prompt: string): Promise<void> {
  const agent = hub.getAgents()[taskId]
  if (!agent?.cwd) throw new HttpError(400, 'Run Claude on this task once before opening it in VS Code.')
  const cli = vscodeCli()
  if (!cli) throw new HttpError(500, 'Visual Studio Code was not found in /Applications.')

  const transcript = agent.sessionId ? findSessionFile(agent.sessionId) : null
  const fullPrompt = transcript
    ? `${prompt}\n\nThe earlier Claude session for this task is saved at ${transcript} (JSON lines). Read it if you need details of what was already done.`
    : prompt

  await run(cli, [agent.cwd]).catch((err: Error) => {
    throw new HttpError(500, `Could not open VS Code: ${err.message}`)
  })
  // Links go to VS Code's last active window unless they name one.
  const windowId = await findWindowId(cli, agent.cwd)
  const url =
    `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(fullPrompt)}` +
    (windowId ? `&windowId=${windowId}` : '')
  await run('open', [url]).catch((err: Error) => {
    throw new HttpError(500, `Could not open the Claude panel: ${err.message}`)
  })
  hub.emitEffect({
    target: 'tasks',
    kind: 'log',
    taskId,
    entry: { at: Date.now(), kind: 'terminal', text: 'Handed off to a new Claude chat in VS Code' },
  })
  if (!windowId) {
    throw new HttpError(
      500,
      "Opened, but couldn't find the folder's VS Code window; the chat may be in another window.",
    )
  }
}

/** Unlocks the task and records what happened in the terminal (best effort). */
export function terminalClosed(hub: AgentHub, taskId: string): void {
  const agent = hub.getAgents()[taskId]
  if (!agent || agent.status !== 'in_terminal') return
  // Left over from an earlier build that locked tasks opened in VS Code.
  if (agent.openedIn === 'vscode') {
    hub.setAgent(taskId, { status: 'idle', terminalOpenedAt: null, openedIn: null })
    return
  }
  const openedAt = agent.terminalOpenedAt ?? Date.now()
  const minutes = Math.max(1, Math.round((Date.now() - openedAt) / 60000))
  const synced = agent.sessionId ? readSessionUsage(agent.sessionId, openedAt) : null

  const patch: Parameters<AgentHub['setAgent']>[1] = {
    status: 'idle',
    terminalOpenedAt: null,
    openedIn: null,
    error: null,
  }
  if (synced && totalTokens(synced.usage) > 0) {
    const summary: RunSummary = {
      id: `terminal-${openedAt}`,
      mode: 'execute',
      model: synced.models.join(', ') || null,
      startedAt: openedAt,
      endedAt: Date.now(),
      resultText: 'Continued in Terminal',
      usage: synced.usage,
      // Interactive sessions don't record cost in the transcript.
      costUsd: 0,
      numTurns: synced.turns,
      durationMs: Date.now() - openedAt,
      permissionDenials: 0,
      isError: false,
      fromTerminal: true,
    }
    const t = agent.totals
    patch.runs = [summary, ...agent.runs].slice(0, 50)
    patch.totals = {
      input: t.input + synced.usage.input,
      output: t.output + synced.usage.output,
      cacheRead: t.cacheRead + synced.usage.cacheRead,
      cacheWrite: t.cacheWrite + synced.usage.cacheWrite,
      costUsd: t.costUsd,
      runs: t.runs,
    }
    hub.emitEffect({
      target: 'dailyStats',
      kind: 'stats',
      dayKey: localDayKey(),
      runs: 0,
      tokens: totalTokens(synced.usage),
      costUsd: 0,
    })
  }
  hub.setAgent(taskId, patch)
  hub.emitEffect({
    target: 'tasks',
    kind: 'log',
    taskId,
    entry: { at: Date.now(), kind: 'terminal', text: `Continued in Terminal (${minutes} min)` },
  })
}

/**
 * Sums token usage recorded after `since` in Claude Code's saved session file.
 * That file format is internal to Claude Code, so any surprise just returns null.
 */
function readSessionUsage(sessionId: string, since: number) {
  try {
    const file = findSessionFile(sessionId)
    if (!file) return null

    const usage = emptyUsage()
    const models = new Set<string>()
    const seen = new Set<string>()
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue
      let o: { type?: string; timestamp?: string; message?: Record<string, unknown> }
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.type !== 'assistant' || !o.message || !o.timestamp) continue
      if (Date.parse(o.timestamp) < since) continue
      // One API message is saved as several lines (one per content block).
      const id = String(o.message.id ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      const u = (o.message.usage ?? {}) as Record<string, number>
      usage.input += u.input_tokens ?? 0
      usage.output += u.output_tokens ?? 0
      usage.cacheRead += u.cache_read_input_tokens ?? 0
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0
      if (typeof o.message.model === 'string') models.add(o.message.model)
    }
    return { usage, models: [...models], turns: seen.size }
  } catch {
    return null
  }
}

/** Claude Code's saved transcript for a session, wherever its project folder is. */
function findSessionFile(sessionId: string): string | null {
  try {
    const root = path.join(os.homedir(), '.claude', 'projects')
    for (const dir of fs.readdirSync(root)) {
      const candidate = path.join(root, dir, `${sessionId}.jsonl`)
      if (fs.existsSync(candidate)) return candidate
    }
  } catch {
    // no projects folder
  }
  return null
}

function localDayKey(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}
