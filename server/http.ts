import type { IncomingMessage, ServerResponse } from 'node:http'

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * The API runs code on this machine, so only accept requests that clearly come
 * from the app itself:
 * - Host must be localhost (blocks DNS-rebinding attacks).
 * - Origin, when sent, must be localhost too; cross-site fetches are refused.
 * - State-changing requests need the custom header, which a foreign page can't
 *   send without a CORS preflight we never approve.
 */
export function rejectUnsafe(req: IncomingMessage): string | null {
  const host = req.headers.host ?? ''
  if (!LOCAL_HOST_RE.test(host)) return 'bad host'

  const origin = req.headers.origin
  if (origin) {
    try {
      if (!LOCAL_HOST_RE.test(new URL(origin).host)) return 'bad origin'
    } catch {
      return 'bad origin'
    }
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'cross-site'

  if (req.method !== 'GET' && req.headers['x-daily-focus'] !== '1') return 'missing header'
  return null
}

export function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export async function readBody<T>(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return (raw ? JSON.parse(raw) : null) as T
}

/** Opens a Server-Sent Events stream and returns a writer for it. */
export function openSSE(res: ServerResponse): (data: unknown) => void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(': connected\n\n')
  return (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}
