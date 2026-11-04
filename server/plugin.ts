import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { RunRequest } from '../src/lib/agentTypes'
import { AgentHub, HttpError, resolveDir } from './agents'
import { openSSE, readBody, rejectUnsafe, sendJSON } from './http'
import { CLIENT_KEYS, Store, isClientKey } from './store'
import { openInTerminal, openInVSCode, terminalClosed } from './terminal'

/**
 * Local API for Daily Focus, mounted on the Vite dev server under /api.
 * Stores app state as JSON files in data/ and runs Claude Code for tasks.
 */
export function dailyFocusApi(): Plugin {
  return {
    name: 'daily-focus-api',
    apply: 'serve',
    configureServer(server) {
      const store = new Store(server.config.root)
      const hub = new AgentHub(store)
      server.httpServer?.on('close', () => hub.shutdown())

      server.middlewares.use('/api', (req, res) => {
        handle(store, hub, req, res).catch((err: unknown) => {
          if (res.headersSent) return
          if (err instanceof HttpError) sendJSON(res, err.status, { error: err.message })
          else sendJSON(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
      })
    },
  }
}

async function handle(store: Store, hub: AgentHub, req: IncomingMessage, res: ServerResponse) {
  const problem = rejectUnsafe(req)
  if (problem) return sendJSON(res, 403, { error: `Forbidden: ${problem}` })

  // Mounted at /api, so req.url is the remainder, e.g. "/state/tasks?ack=..".
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const method = req.method ?? 'GET'

  // GET /api/state - everything the app needs on load.
  if (method === 'GET' && parts.length === 1 && parts[0] === 'state') {
    const state: Record<string, unknown> = { initialized: store.exists('tasks') }
    for (const key of CLIENT_KEYS) state[key] = store.read(key, null)
    state.revs = store.revsFor(CLIENT_KEYS)
    state.agents = hub.getAgents()
    state.effects = hub.getEffects()
    return sendJSON(res, 200, state)
  }

  // PUT /api/state/:key?rev=N[&ack=id,id] - save one client-owned file if N is
  // still its current revision, then drop the server effects it now includes.
  if (method === 'PUT' && parts.length === 2 && parts[0] === 'state') {
    const key = parts[1]
    if (!isClientKey(key)) throw new HttpError(404, `Unknown state key: ${key}`)
    const baseRev = Number(url.searchParams.get('rev'))
    const body = await readBody(req)
    const rev = Number.isInteger(baseRev) && url.searchParams.has('rev')
      ? store.writeIfCurrent(key, baseRev, body)
      : null
    if (rev == null) {
      return sendJSON(res, 409, {
        error: 'Changed in another tab or browser',
        conflict: true,
        rev: store.rev(key),
      })
    }
    const ack = url.searchParams.get('ack')
    if (ack) hub.ackEffects(ack.split(',').filter(Boolean))
    return sendJSON(res, 200, { ok: true, rev })
  }

  // GET /api/live - agent state + undelivered effects; fetched whenever the
  // event stream (re)connects so nothing emitted in between is missed.
  if (method === 'GET' && parts.length === 1 && parts[0] === 'live') {
    return sendJSON(res, 200, { agents: hub.getAgents(), effects: hub.getEffects() })
  }

  // GET /api/events - live agent state + effects.
  if (method === 'GET' && parts.length === 1 && parts[0] === 'events') {
    const send = openSSE(res)
    const unsubscribe = hub.subscribe(send)
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    req.on('close', () => {
      clearInterval(ping)
      unsubscribe()
    })
    return
  }

  // POST /api/check-dir - validate a working folder from the settings UI.
  if (method === 'POST' && parts.length === 1 && parts[0] === 'check-dir') {
    const body = await readBody<{ path?: string }>(req)
    try {
      const resolved = resolveDir(body?.path)
      const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      return sendJSON(res, 200, {
        ok: isDir,
        resolved,
        isGitRepo: isDir && fs.existsSync(path.join(resolved, '.git')),
        error: isDir ? null : 'Folder not found',
      })
    } catch (err) {
      return sendJSON(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // /api/tasks/:id/...
  if (parts[0] === 'tasks' && parts.length >= 3) {
    const taskId = parts[1]
    const action = parts[2]

    if (method === 'POST' && action === 'run' && parts.length === 3) {
      const body = await readBody<RunRequest>(req)
      if (!body || typeof body.prompt !== 'string') throw new HttpError(400, 'Missing prompt')
      const runId = hub.startRun(taskId, body)
      return sendJSON(res, 200, { runId })
    }
    if (method === 'POST' && action === 'stop') {
      hub.stop(taskId)
      return sendJSON(res, 200, { ok: true })
    }
    if (method === 'DELETE' && action === 'agent') {
      hub.forget(taskId)
      return sendJSON(res, 200, { ok: true })
    }
    if (method === 'POST' && action === 'ack') {
      hub.acknowledge(taskId)
      return sendJSON(res, 200, { ok: true })
    }
    if (method === 'POST' && action === 'terminal') {
      const host = req.headers.host ?? 'localhost:5173'
      await openInTerminal(hub, taskId, `http://${host}`)
      return sendJSON(res, 200, { ok: true })
    }
    if (method === 'POST' && action === 'vscode') {
      const body = await readBody<{ prompt?: string }>(req)
      await openInVSCode(hub, taskId, body?.prompt ?? '')
      return sendJSON(res, 200, { ok: true })
    }
    if (method === 'POST' && action === 'terminal-closed') {
      terminalClosed(hub, taskId)
      return sendJSON(res, 200, { ok: true })
    }
    // GET /api/tasks/:id/runs/:runId/events - one run's log.
    if (method === 'GET' && action === 'runs' && parts.length === 5 && parts[4] === 'events') {
      const send = openSSE(res)
      const unsubscribe = hub.subscribeRun(taskId, parts[3], (line) => {
        send(line)
        if (line.kind === 'end') res.end()
      })
      req.on('close', unsubscribe)
      return
    }
  }

  sendJSON(res, 404, { error: 'Not found' })
}
