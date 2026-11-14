import { describe, expect, it } from 'vitest'
import type { WorkBuddyUpstreamModel } from '../src/upstream.ts'
import { normalizePromotionDefinitions, promotionFacts } from '../src/promotions.ts'

const now = Date.parse('2026-11-13T16:00:00Z') // Shanghai midnight.
const source = { source: 'product-config' as const, fetchedAt: now }
const model: WorkBuddyUpstreamModel = { id: 'example', name: 'Example', contextWindow: 1000, maxTokens: 100, supportsImages: false, billing: { credits: 'x0.50', free: false } }
function raw(schedule: unknown, extra: Record<string, unknown> = {}) {
  return [{ enabled: true, modelIds: ['example'], schedule, discount: { factor: 0.5, discountedCredits: '0.50x', displayMode: 'strikethrough' }, badge: { label: 'Night discount', icon: 'private-extra-marker' }, priority: 100, ...extra }]
}
function withDefinitions(input: unknown) { return { ...model, promotionDefinitions: normalizePromotionDefinitions(input, model.id) } }

describe('source-bound promotion facts', () => {
  it('reports fixed interval bounds and explicit price without applying another multiplier', () => {
    const input = withDefinitions(raw({ validFrom: '2026-11-13T00:00:00+08:00', validUntil: '2026-11-16T00:00:00+08:00', timezone: 'Asia/Shanghai' }))
    const before = structuredClone(input)
    const facts = promotionFacts(input, source, now)
    expect(facts).toMatchObject({ state: 'active', source: 'product-config', freshness: 'fresh', schedule: 'fixed', priceKnown: true, effectiveCredits: 'x0.50', validFrom: Date.parse('2026-11-13T00:00:00+08:00'), validUntil: Date.parse('2026-11-16T00:00:00+08:00') })
    expect(input).toEqual(before)
    expect(JSON.stringify(facts)).not.toContain('private-extra-marker')
  })
  it('expires a fixed offer at its exclusive end and does not retain its price', () => {
    const input = withDefinitions(raw({ validFrom: '2026-11-13T00:00:00+08:00', validUntil: '2026-11-14T00:00:00+08:00' }))
    expect(promotionFacts(input, source, now)).toMatchObject({ state: 'expired', priceKnown: false })
    expect(promotionFacts(input, source, now)).not.toHaveProperty('effectiveCredits')
  })
  it.each([
    ['2026-11-13T14:59:00Z', 'inactive'], // Shanghai22:59.
    ['2026-11-13T15:00:00Z', 'active'],
    ['2026-11-13T23:49:00Z', 'active'],
    ['2026-11-13T23:50:00Z', 'inactive'],
  ])('evaluates verified Shanghai midnight-wrapping daily windows at %s', (instant, state) => {
    const time = Date.parse(instant)
    const input = withDefinitions(raw({ daily: [{ start: '23:00', end: '7:50' }], timezone: 'Asia/Shanghai' }))
    const facts = promotionFacts(input, { ...source, fetchedAt: time }, time)
    expect(facts).toMatchObject({ state, schedule: 'daily', timeZone: 'Asia/Shanghai', daily: [{ start: '23:00', end: '07:50' }] })
    expect(facts.priceKnown).toBe(state === 'active')
  })
  it('treats equal daily endpoints as the verified all-day shape', () => {
    const input = withDefinitions(raw({ daily: [{ start: '0:00', end: '0:00' }], timezone: 'Asia/Shanghai' }))
    expect(promotionFacts(input, source, now).state).toBe('active')
  })
  it.each([
    { daily: [{ start: '23:00', end: '7:50' }] },
    { daily: [{ start: '23:00', end: '7:50' }], timezone: 'No/Such_Zone' },
    { weekly: ['Monday'], timezone: 'Asia/Shanghai' },
    { daily: [{ start: '25:00', end: '7:50' }], timezone: 'Asia/Shanghai' },
    { validFrom: '2026-11-13T00:00:00', validUntil: '2026-11-16T00:00:00' },
  ])('does not turn an unsupported or ambiguous schedule into an active price', schedule => {
    const facts = promotionFacts(withDefinitions(raw(schedule)), source, now)
    expect(facts).toMatchObject({ state: 'unknown', schedule: 'unsupported', priceKnown: false })
    expect(facts).not.toHaveProperty('effectiveCredits')
  })
  it('keeps badge-only activity separate from an unknown discounted price', () => {
    const input = withDefinitions(raw({ daily: [{ start: '0:00', end: '23:59' }], timezone: 'Asia/Shanghai' }, { discount: undefined }))
    expect(promotionFacts(input, source, now)).toMatchObject({ state: 'active', priceKnown: false })
    expect(promotionFacts({ ...model, billing: { free: true, credits: 'x0.00', badges: ['Free'] } }, source, now)).toMatchObject({ state: 'unknown', schedule: 'not-declared', priceKnown: false })
  })
  it('marks stale and invalid source times unknown even when a declared window would be active', () => {
    const input = withDefinitions(raw({ daily: [{ start: '0:00', end: '0:00' }], timezone: 'Asia/Shanghai' }))
    expect(promotionFacts(input, { ...source, fetchedAt: now - 86_400_001 }, now)).toMatchObject({ state: 'unknown', freshness: 'stale', priceKnown: false })
    expect(promotionFacts(input, { ...source, fetchedAt: now + 5001 }, now)).toMatchObject({ state: 'unknown', freshness: 'unknown', priceKnown: false })
  })
  it('uses the highest active priority and never multiplies legacy already-discounted credits', () => {
    const rows = [
      ...raw({ daily: [{ start: '23:00', end: '7:50' }], timezone: 'Asia/Shanghai' }),
      ...raw({ daily: [{ start: '7:50', end: '23:00' }], timezone: 'Asia/Shanghai' }, { priority: 50, discount: undefined, badge: { label: 'Later' } }),
    ]
    expect(promotionFacts(withDefinitions(rows), source, now)).toMatchObject({ state: 'active', label: 'Night discount', effectiveCredits: 'x0.50' })
    const legacy = { ...model, promotions: [{ start: now - 1000, end: now + 1000, label: 'Legacy', factor: 0.5, priority: 0 }] }
    expect(promotionFacts(legacy, source, now)).toMatchObject({ state: 'active', priceKnown: false })
    expect(promotionFacts(legacy, source, now)).not.toHaveProperty('effectiveCredits')
  })
  it('allows verified replace-to-zero without a base price but drops malformed or wrong-model entries', () => {
    const input = withDefinitions(raw({ validFrom: '2026-11-13T00:00:00Z', validUntil: '2026-11-14T00:00:00Z' }, { discount: { factor: 0, displayMode: 'replace' } }))
    expect(promotionFacts(input, source, now)).toMatchObject({ state: 'active', effectiveCredits: 'x0.00', priceKnown: true })
    expect(normalizePromotionDefinitions(raw({ daily: [] }, { modelIds: ['other-model'] }), model.id)).toEqual([])
  })
  it('rejects impossible calendar dates instead of normalizing them into a different offer window', () => {
    const invalid = withDefinitions(raw({ validFrom: '2026-02-30T00:00:00Z', validUntil: '2026-03-04T00:00:00Z' }))
    const instant = Date.parse('2026-03-02T00:00:00Z')
    expect(promotionFacts(invalid, { ...source, fetchedAt: instant }, instant)).toMatchObject({ state: 'unknown', schedule: 'unsupported', priceKnown: false })
  })
})
