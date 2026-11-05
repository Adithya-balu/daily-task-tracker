import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWorkflowConfig } from '../../server/workflow/config'
import { blankWorkflow, flowPreview, freeStageId, moveStage, newStage, removeStage, renameStage, setStage, syncTransitions } from './workflowEdit'
import { validateWorkflow } from './workflowValidate'

const { workflows, agents } = loadWorkflowConfig(path.resolve(__dirname, '../../workflows'))
const standard = workflows['standard-dev'].def

describe('workflow edits', () => {
  it('previews the main path and its loops', () => {
    expect(flowPreview(standard)).toBe(
      'analysis → plan_approval (rejected ↺ analysis) → implement → ci (fail ↺ implement) → review (changes_requested ↺ implement) → merge_approval (rejected ↺ implement) → done',
    )
  })

  it('renames a stage and every transition into it, keeping the order', () => {
    const def = renameStage(standard, 'implement', 'build')
    expect(Object.keys(def.stages)[2]).toBe('build')
    expect(def.stages.ci.next.fail).toBe('build')
    expect(def.stages.merge_approval.next.rejected).toBe('build')
    expect(validateWorkflow(def, agents)).toEqual([])
  })

  it('keeps existing targets when an agent stage switches to another agent', () => {
    const review = standard.stages.review
    const asCoder = syncTransitions({ ...review, type: 'agent', agent: 'coder', mode: 'implement' } as typeof review, agents)
    expect(asCoder.next).toEqual({ done: 'done' })
    const back = syncTransitions({ ...asCoder, agent: 'reviewer', mode: 'default' } as typeof review, agents)
    expect(back.next).toEqual({ approved: 'done', changes_requested: 'done' })
  })

  it('builds a valid workflow from blank with new stages', () => {
    let def = blankWorkflow('mine')
    def = setStage(def, 'implement', { ...newStage('agent', agents), mode: 'implement' } as never)
    def = setStage(def, 'implement', syncTransitions(def.stages.implement, agents))
    def = setStage(def, freeStageId(def, 'implement'), newStage('gate', agents))
    expect(Object.keys(def.stages)).toEqual(['implement', 'implement_2'])
    def = setStage(def, 'implement', { ...def.stages.implement, next: { done: 'implement_2' } })
    expect(validateWorkflow(def, agents)).toEqual([])
  })

  it('leaves dangling transitions for validation after a removal, and moves stages', () => {
    const def = removeStage(standard, 'ci')
    expect(validateWorkflow(def, agents)).toContain('stages.implement.next.done: unknown stage "ci"')
    expect(Object.keys(moveStage(standard, 'ci', -1).stages).slice(2, 4)).toEqual(['ci', 'implement'])
    expect(moveStage(standard, 'analysis', -1)).toBe(standard)
  })
})
