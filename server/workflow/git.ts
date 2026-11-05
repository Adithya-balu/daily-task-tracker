import { execFile } from 'node:child_process'

/** Diffs bigger than this are cut so the API and UI stay responsive. */
const MAX_PATCH = 2 * 1024 * 1024

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolve({ code, stdout, stderr })
    })
  })
}

async function ok(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args)
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`)
  return r.stdout
}

/** Requires a clean repo with at least one commit; branches off HEAD. */
export async function prepareBranch(cwd: string, branch: string): Promise<{ baseRef: string }> {
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])).code !== 0) {
    throw new Error(`${cwd} is not a git repository. Workflows need git to keep each task's changes on a branch.`)
  }
  const head = await git(cwd, ['rev-parse', 'HEAD'])
  if (head.code !== 0) throw new Error('The repository has no commits yet. Make an initial commit first.')
  const status = await ok(cwd, ['status', '--porcelain'])
  if (status.trim()) {
    throw new Error(`${cwd} has uncommitted changes. Commit or stash them before starting a workflow.`)
  }
  await ok(cwd, ['checkout', '-b', branch])
  return { baseRef: head.stdout.trim() }
}

export async function commitAll(cwd: string, message: string): Promise<boolean> {
  await ok(cwd, ['add', '-A'])
  if ((await git(cwd, ['diff', '--cached', '--quiet'])).code === 0) return false
  await ok(cwd, ['commit', '-m', message])
  return true
}

export async function diff(cwd: string, baseRef: string): Promise<{ stat: string; patch: string }> {
  const range = `${baseRef}..HEAD`
  const stat = await ok(cwd, ['diff', '--stat', range])
  let patch = await ok(cwd, ['diff', range])
  if (patch.length > MAX_PATCH) patch = `${patch.slice(0, MAX_PATCH)}\n\n[diff truncated]\n`
  return { stat, patch }
}
