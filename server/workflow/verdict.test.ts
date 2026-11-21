import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWorkflowConfig } from './config'
import { checkSchema, decideOutcome, parseVerdict } from './verdict'

const { agents } = loadWorkflowConfig(path.resolve(__dirname, '../../workflows'))
const reviewMode = agents.reviewer.modes.default

describe('checkSchema', () => {
  it('reports nested type, enum and required errors with paths', () => {
    const errors = checkSchema(
      { verdict: 'nope', summary: 3, issues: [{ severity: 'major', line: 1.5 }] },
      reviewMode.outputSchema,
    )
    expect(errors).toEqual([
      'output.verdict: must be one of "approved", "changes_requested"',
      'output.summary: must be a string',
      'output.issues[0].description: is required',
      'output.issues[0].line: must be an integer',
    ])
  })

  it('rejects non-objects', () => {
    expect(checkSchema([], reviewMode.outputSchema)).toEqual(['output: must be an object'])
  })
})

describe('parseVerdict', () => {
  it('accepts valid output, including JSON strings', () => {
    const value = { verdict: 'approved', summary: 'ok', issues: [] }
    expect(parseVerdict(value, reviewMode)).toEqual({ ok: true, verdict: value })
    expect(parseVerdict(JSON.stringify(value), reviewMode)).toEqual({ ok: true, verdict: value })
  })

  it('rejects missing and unparseable output', () => {
    expect(parseVerdict(null, reviewMode)).toEqual({ ok: false, errors: ['No structured output was returned.'] })
    expect(parseVerdict('{nope', reviewMode)).toEqual({ ok: false, errors: ['Structured output is not valid JSON.'] })
  })

  it('defaults issues to an empty list for agents without them', () => {
    const r = parseVerdict(
      { verdict: 'done', summary: 's', filesChanged: [] },
      agents.coder.modes.implement,
    )
    expect(r.ok && r.verdict.issues).toEqual([])
  })
})

describe('decideOutcome', () => {
  const v = (verdict: string, ...severities: string[]) => ({
    verdict,
    summary: '',
    issues: severities.map((severity) => ({ severity, description: '' })) as never,
  })

  it('uses severities for the reviewer', () => {
    expect(decideOutcome(agents.reviewer, v('changes_requested', 'minor'))).toEqual({ outcome: 'approved', normalized: true })
    expect(decideOutcome(agents.reviewer, v('approved', 'major'))).toEqual({ outcome: 'changes_requested', normalized: true })
    expect(decideOutcome(agents.reviewer, v('changes_requested', 'blocker', 'minor'))).toEqual({
      outcome: 'changes_requested',
      normalized: false,
    })
    expect(decideOutcome(agents.reviewer, v('approved'))).toEqual({ outcome: 'approved', normalized: false })
  })

  it('trusts the verdict for agents without a rule', () => {
    expect(decideOutcome(agents.coder, v('done'))).toEqual({ outcome: 'done', normalized: false })
  })
})
