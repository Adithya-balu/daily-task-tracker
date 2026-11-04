import { useState } from 'react'
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  type ClaudeConfig,
  type ClaudeEffort,
  type ClaudeModel,
  type ExecuteMode,
} from '../lib/types'
import type { ResolvedClaudeConfig } from '../lib/claude'
import { api } from '../lib/api'
import { FieldLabel, inputClass } from './ui'

type Props = {
  /** Values set at this level (task overrides or project defaults). */
  value: ClaudeConfig
  /** What applies when a field here is left unset. */
  inherited: ResolvedClaudeConfig
  inheritLabel: string
  onChange: (patch: Partial<ClaudeConfig>) => void
  showWorkingDir?: boolean
}

/** Model / effort / permissions / budget fields, each able to inherit. */
export function ClaudeSettingsFields({
  value,
  inherited,
  inheritLabel,
  onChange,
  showWorkingDir = true,
}: Props) {
  const triState = (v: boolean | undefined) => (v === undefined ? '' : v ? 'yes' : 'no')
  const fromTriState = (s: string) => (s === '' ? undefined : s === 'yes')

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showWorkingDir && (
        <div className="sm:col-span-2">
          <FieldLabel>Working folder</FieldLabel>
          <WorkingDirInput
            value={value.workingDir ?? ''}
            placeholder={inherited.workingDir ? `${inheritLabel}: ${inherited.workingDir}` : '/Users/you/code/my-repo'}
            onChange={(v) => onChange({ workingDir: v || undefined })}
          />
        </div>
      )}

      <label>
        <FieldLabel>Model</FieldLabel>
        <select
          value={value.model ?? ''}
          onChange={(e) => onChange({ model: (e.target.value || undefined) as ClaudeModel | undefined })}
          className={inputClass}
        >
          <option value="">
            {inheritLabel} ({inherited.model})
          </option>
          {CLAUDE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label>
        <FieldLabel>Effort</FieldLabel>
        <select
          value={value.effort ?? ''}
          onChange={(e) =>
            onChange({ effort: (e.target.value || undefined) as ClaudeEffort | undefined })
          }
          className={inputClass}
        >
          <option value="">
            {inheritLabel} ({inherited.effort ?? 'CLI default'})
          </option>
          {CLAUDE_EFFORTS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label>
        <FieldLabel>Plan first</FieldLabel>
        <select
          value={triState(value.planFirst)}
          onChange={(e) => onChange({ planFirst: fromTriState(e.target.value) })}
          className={inputClass}
        >
          <option value="">
            {inheritLabel} ({inherited.planFirst ? 'yes' : 'no'})
          </option>
          <option value="yes">Yes - plan, then wait for approval</option>
          <option value="no">No - start working right away</option>
        </select>
      </label>

      <label>
        <FieldLabel>When working</FieldLabel>
        <select
          value={value.executeMode ?? ''}
          onChange={(e) =>
            onChange({ executeMode: (e.target.value || undefined) as ExecuteMode | undefined })
          }
          className={inputClass}
        >
          <option value="">
            {inheritLabel} ({inherited.executeMode})
          </option>
          <option value="acceptEdits">acceptEdits - edit files, ask for other tools</option>
          <option value="auto">auto - classifier approves safe actions</option>
        </select>
      </label>

      <label className="sm:col-span-2">
        <FieldLabel>Also allow tools</FieldLabel>
        <input
          value={value.allowedTools ?? ''}
          onChange={(e) => onChange({ allowedTools: e.target.value || undefined })}
          placeholder={
            inherited.allowedTools
              ? `${inheritLabel}: ${inherited.allowedTools}`
              : 'Comma separated, e.g. Bash(npm test), Bash(git diff *)'
          }
          className={`${inputClass} font-mono text-xs`}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Headless runs can't ask you for permission, so anything not allowed here is denied.
        </span>
      </label>

      <label>
        <FieldLabel>Budget cap (USD, per run)</FieldLabel>
        <input
          type="number"
          min={0}
          step={0.5}
          value={value.maxBudgetUsd ?? ''}
          onChange={(e) =>
            onChange({ maxBudgetUsd: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          placeholder={inherited.maxBudgetUsd ? `${inheritLabel}: ${inherited.maxBudgetUsd}` : 'No cap'}
          className={inputClass}
        />
      </label>

      <label>
        <FieldLabel>Git worktree</FieldLabel>
        <select
          value={triState(value.useWorktree)}
          onChange={(e) => onChange({ useWorktree: fromTriState(e.target.value) })}
          className={inputClass}
        >
          <option value="">
            {inheritLabel} ({inherited.useWorktree ? 'yes' : 'no'})
          </option>
          <option value="yes">Yes - isolate in its own worktree</option>
          <option value="no">No - work in the folder directly</option>
        </select>
      </label>
    </div>
  )
}

/** Text input for a folder path with a server-side existence check. */
export function WorkingDirInput({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)

  const verify = async (path: string) => {
    if (!path.trim()) {
      setCheck(null)
      return
    }
    try {
      const r = await api<{ ok: boolean; resolved?: string; isGitRepo?: boolean; error?: string }>(
        '/check-dir',
        { method: 'POST', body: { path } },
      )
      setCheck(
        r.ok
          ? { ok: true, text: r.isGitRepo ? 'Folder found · git repo' : 'Folder found · not a git repo' }
          : { ok: false, text: r.error ?? 'Folder not found' },
      )
    } catch (err) {
      setCheck({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setCheck(null)
        }}
        onBlur={(e) => void verify(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} font-mono text-xs`}
      />
      {check && (
        <span className={`mt-1 block text-xs ${check.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
          {check.text}
        </span>
      )}
    </div>
  )
}
