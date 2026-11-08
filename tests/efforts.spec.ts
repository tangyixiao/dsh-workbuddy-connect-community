import { describe, expect, it } from 'vitest'
import { resolveDefaultEffort, resolveEfforts } from '../src/efforts.ts'
import { reasoningFields } from '../src/adapter.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'
import type { WorkBuddyProbeRecord } from '../src/probe-store.ts'

const model: WorkBuddyModelInfo = {
  id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 100, supportsImages: false,
  reasoning: { supports: true, onlyReasoning: true, canDisableThinking: true, supportedEfforts: ['low', 'max'], defaultEffort: 'max' },
}
const observed: WorkBuddyProbeRecord = {
  validation: 'validating', efforts: ['medium', 'high'],
  fingerprint: 'fixture', account: 'test', probedAtMs: 1, pluginVersion: 'test',
}
const undeclared: WorkBuddyModelInfo = { ...model, reasoning: { ...model.reasoning!, supportedEfforts: [] } }

describe('shared effort resolution', () => {
  it('keeps a declared set even when an observation disagrees', () => {
    expect(resolveEfforts(model, observed)).toEqual({ efforts: ['low', 'max'], source: 'declared', off: false, probeEligible: false })
    expect(reasoningFields(model, observed).thinkingLevelMap).toMatchObject({ low: 'low', max: 'max', medium: null, high: null })
  })

  it('uses only validating observations for undeclared models, without granting Off', () => {
    expect(resolveEfforts(undeclared, observed)).toEqual({ efforts: ['medium', 'high'], source: 'observed', off: false, probeEligible: true })
    expect(reasoningFields(undeclared, observed).thinkingLevelMap).toMatchObject({ off: null, minimal: null, medium: 'medium', high: 'high', max: null })
  })

  it.each(['unknown', 'non-validating'] as const)('offers no switch for a %s observation', validation => {
    const record = { ...observed, validation }
    expect(resolveEfforts(undeclared, record)).toEqual({ efforts: [], off: false, probeEligible: true })
    expect(reasoningFields(undeclared, record)).toEqual({ reasoning: false })
  })

  it('offers no switch without an observation or an accepted level', () => {
    expect(reasoningFields(undeclared)).toEqual({ reasoning: false })
    expect(reasoningFields(undeclared, { ...observed, efforts: [] })).toEqual({ reasoning: false })
  })

  it('ignores declarations and observations for non-reasoning models', () => {
    const plain = { ...model, reasoning: { ...model.reasoning!, supports: false } }
    expect(resolveEfforts(plain, observed)).toEqual({ efforts: [], off: false, probeEligible: false })
    expect(reasoningFields(plain, observed)).toEqual({ reasoning: false })
    const { reasoning: _reasoning, ...withoutReasoning } = model
    expect(resolveEfforts(withoutReasoning)).toEqual({ efforts: [], off: false, probeEligible: false })
  })

  it('applies the onlyReasoning Off veto only on CN', () => {
    expect(resolveEfforts(model, undefined, 'cn').off).toBe(false)
    expect(resolveEfforts(model, undefined, 'global').off).toBe(true)
    const canDisable = { ...model, reasoning: { ...model.reasoning!, onlyReasoning: false } }
    expect(resolveEfforts(canDisable).off).toBe(true)
    expect(resolveEfforts({ ...model, reasoning: { ...model.reasoning!, canDisableThinking: false } }, undefined, 'global').off).toBe(false)
  })

  it('returns only an upstream default among offered levels', () => {
    expect(resolveDefaultEffort(model, resolveEfforts(model).efforts)).toBe('max')
    expect(resolveDefaultEffort({ ...model, reasoning: { ...model.reasoning!, defaultEffort: 'medium' } }, resolveEfforts(model).efforts)).toBeUndefined()
    const { defaultEffort: _defaultEffort, ...withoutDefault } = model.reasoning!
    expect(resolveDefaultEffort({ ...model, reasoning: withoutDefault }, resolveEfforts(model).efforts)).toBeUndefined()
    expect(resolveDefaultEffort(undeclared, resolveEfforts(undeclared).efforts)).toBeUndefined()
    const legacy = { ...undeclared, reasoning: { ...undeclared.reasoning!, defaultEffort: 'medium' as const } }
    expect(resolveDefaultEffort(legacy, resolveEfforts(legacy, observed).efforts)).toBe('medium')
  })
})
