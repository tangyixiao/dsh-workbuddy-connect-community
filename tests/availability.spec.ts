import { describe, expect, it } from 'vitest'
import { WorkBuddyAvailabilityStore, parseRetryAfter } from '../src/availability.ts'

describe('observed availability', () => {
  it('isolates accounts/models and expires without claiming unknown models are healthy', () => {
    let now = 1000
    const store = new WorkBuddyAvailabilityStore({ now: () => now, ttlMs: 100, limit: 2 })
    store.record('a', 'm', 'model_busy', 14003)
    expect(store.get('a', 'm')).toMatchObject({ kind: 'model_busy', observedAt: 1000, expiresAt: 1100, source: 'response' })
    expect(store.get('b', 'm')).toBeUndefined()
    expect(store.get('a', 'other')).toBeUndefined()
    now = 1100
    expect(store.get('a', 'm')).toBeUndefined()
  })
  it('caps memory, ignores unrelated failures and clears only the observed account/model', () => {
    const store = new WorkBuddyAvailabilityStore({ now: () => 1000, ttlMs: 100, limit: 2 })
    store.record('a', 'old', 'queue', 6020)
    store.record('a', 'm', 'queue', 6021)
    store.record('b', 'm', 'model_busy', 14003)
    expect(store.get('a', 'old')).toBeUndefined()
    store.record('a', 'm', 'policy_reject', 11140)
    expect(store.get('a', 'm')?.code).toBe(6021)
    store.success('a', 'm')
    expect(store.get('a', 'm')).toBeUndefined()
    expect(store.get('b', 'm')?.kind).toBe('model_busy')
  })
  it('parses only bounded concrete Retry-After values', () => {
    expect(parseRetryAfter('5', 1000)).toBe(6000)
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT', 1000)).toBe(3000)
    for (const value of [null, '', '-2', 'Infinity', '0', '9999999999999', 'junk']) expect(parseRetryAfter(value, 1000)).toBeUndefined()
  })
})
