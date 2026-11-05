import fs from 'node:fs'
import path from 'node:path'

/** State files the browser owns and saves wholesale. */
export const CLIENT_KEYS = [
  'tasks',
  'projects',
  'brainDump',
  'settings',
  'dailyStats',
  'timeBlocks',
] as const
export type ClientKey = (typeof CLIENT_KEYS)[number]

export function isClientKey(key: string): key is ClientKey {
  return (CLIENT_KEYS as readonly string[]).includes(key)
}

/** Small JSON file store under <root>/data with atomic writes. */
export class Store {
  readonly dir: string
  /** Revision per client-owned file; a save must name the revision it was based on. */
  private revs: Record<string, number>

  constructor(root: string) {
    this.dir = path.join(root, 'data')
    fs.mkdirSync(path.join(this.dir, 'runs'), { recursive: true })
    this.revs = this.read<Record<string, number>>('revs', {})
  }

  rev(key: ClientKey): number {
    return this.revs[key] ?? 0
  }

  revsFor(keys: readonly ClientKey[]): Record<string, number> {
    return Object.fromEntries(keys.map((k) => [k, this.rev(k)]))
  }

  /**
   * Saves a client-owned file only if the client saw the latest revision, so a
   * stale tab can't overwrite newer data. Returns the new revision, or null on
   * a conflict.
   */
  writeIfCurrent(key: ClientKey, baseRev: number, value: unknown): number | null {
    if (baseRev !== this.rev(key)) return null
    this.write(key, value)
    this.revs[key] = this.rev(key) + 1
    this.write('revs', this.revs)
    return this.revs[key]
  }

  private file(name: string): string {
    return path.join(this.dir, `${name}.json`)
  }

  exists(name: string): boolean {
    return fs.existsSync(this.file(name))
  }

  read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8')) as T
    } catch {
      return fallback
    }
  }

  write(name: string, value: unknown): void {
    writeFileAtomic(this.file(name), JSON.stringify(value, null, 2))
  }

  /** Workflows and agents edited in the AI section. */
  get aiDir(): string {
    return path.join(this.dir, 'ai')
  }

  runLogPath(taskId: string, runId: string): string {
    const dir = path.join(this.dir, 'runs', safeSegment(taskId))
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, `${safeSegment(runId)}.jsonl`)
  }

  removeRunLogs(taskId: string): void {
    removeDir(path.join(this.dir, 'runs', safeSegment(taskId)))
  }

  /** Branch diff saved after a workflow stage. */
  workflowDiffPath(taskId: string, recordId: string): string {
    const dir = path.join(this.dir, 'workflows', safeSegment(taskId))
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, `${safeSegment(recordId)}.diff`)
  }

  removeWorkflowFiles(taskId: string): void {
    removeDir(path.join(this.dir, 'workflows', safeSegment(taskId)))
  }
}

/** Write to a temp file then rename, so a crash never leaves half a file. */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Ids come from the client; keep them from escaping the data directory. */
export function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_')
}
