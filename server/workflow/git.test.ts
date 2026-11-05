import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAll, diff, prepareBranch } from './git'

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

describe('workflow git helpers', () => {
  let dir: string
  const saved = { ...process.env }
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

  beforeEach(() => {
    Object.assign(process.env, GIT_ENV)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-git-'))
    run('init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    run('add', '-A')
    run('commit', '-q', '-m', 'init')
  })

  afterEach(() => {
    process.env = saved
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('branches off a clean HEAD, commits changes and diffs against the base', async () => {
    const base = run('rev-parse', 'HEAD')
    expect(await prepareBranch(dir, 'daily-focus/t-1')).toEqual({ baseRef: base })
    expect(run('branch', '--show-current')).toBe('daily-focus/t-1')

    expect(await commitAll(dir, 'nothing')).toBe(false)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'new\n')
    expect(await commitAll(dir, 'daily-focus: implement')).toBe(true)

    const d = await diff(dir, base)
    expect(d.stat).toContain('2 files changed')
    expect(d.patch).toContain('+two')
    expect(d.patch).toContain('b.txt')
  })

  it('refuses dirty trees and non-repos', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty\n')
    await expect(prepareBranch(dir, 'x')).rejects.toThrow(/uncommitted changes/)
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'df-plain-'))
    await expect(prepareBranch(plain, 'x')).rejects.toThrow(/not a git repository/)
    fs.rmSync(plain, { recursive: true, force: true })
  })
})
