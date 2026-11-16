import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyUsageStore, type UsageRecord } from '../src/usage-store.ts'

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 16, 12)
const account = `cn-${'a'.repeat(32)}`
const other = `cn-${'b'.repeat(32)}`
const owned: string[] = []
afterEach(async () => { await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(options: { maxRecords?: number; maxBytes?: number } = {}) {
  const parent = join(process.cwd(), 'work/account-usage-20261116/usage-tests')
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'fixture-')); owned.push(dir)
  const path = join(dir, 'usage.json')
  return { path, store: new WorkBuddyUsageStore(path, 'cn', { now: () => now, ...options }) }
}
function row(id: string, values: Partial<UsageRecord> = {}): UsageRecord { return { account, model: 'hy3', responseId: id, completedAt: now, ...values } }

describe('bounded durable observed usage', () => {
  it('reloads, deduplicates per account, preserves unknown credits and projects rolling windows', async () => {
    const f = await fixture()
    await f.store.record(row('one', { credit: 0 }))
    await f.store.record(row('one', { credit: 99 }))
    await f.store.record(row('unknown', { completedAt: now - 2 * DAY }))
    await f.store.record(row('older', { model: 'other', credit: 3, completedAt: now - 10 * DAY }))
    await f.store.record(row('one', { account: other, credit: 5 }))
    const summary = await new WorkBuddyUsageStore(f.path, 'cn', { now: () => now }).read([account])
    expect(summary.status).toBe('available')
    expect(summary.persistence).toBe('persisted')
    expect(summary.windows['1']).toEqual({ requests: 1, knownCreditRequests: 1, unknownCreditRequests: 0, observedCredits: 0 })
    expect(summary.windows['7']).toEqual({ requests: 2, knownCreditRequests: 1, unknownCreditRequests: 1, observedCredits: 0 })
    expect(summary.windows['30'].observedCredits).toBe(3)
    expect(summary.recent).toHaveLength(3)
    expect(summary.byAccount.map(value => value.account)).toEqual([account])
    expect(summary.byModel.map(value => value.model).sort()).toEqual(['hy3', 'other'])
    expect(await f.store.read([])).toMatchObject({ recent: [], byAccount: [], byModel: [] })
  })
  it('retains 31 days and caps entry count, with explicit truncated coverage', async () => {
    const f = await fixture({ maxRecords: 3 })
    await f.store.record(row('expired', { completedAt: now - 31 * DAY - 1 }))
    for (let i = 0; i < 5; i++) await f.store.record(row(String(i), { completedAt: now - 5 + i }))
    const value = await f.store.read([account])
    expect(value.recent.map(item => item.responseId)).toEqual(['4', '3', '2'])
    expect(value.coverage).toMatchObject({ retentionDays: 31, maxRecords: 3, truncated: true, from: now - 3 })
    expect(JSON.parse(await readFile(f.path, 'utf8')).records).toHaveLength(3)
  })
  it('caps bytes and 100 recent details while keeping complete bounded aggregates', async () => {
    const f = await fixture({ maxBytes: 1024 })
    await Promise.all(Array.from({ length: 30 }, (_, i) => f.store.record(row(String(i), { model: '中'.repeat(100) }))))
    expect((await stat(f.path)).size).toBeLessThanOrEqual(1024)
    expect((await f.store.read([account])).coverage.truncated).toBe(true)
    const large = await fixture()
    await Promise.all(Array.from({ length: 105 }, (_, i) => large.store.record(row(String(i)))))
    const summary = await large.store.read([account])
    expect(summary.windows['1'].requests).toBe(105)
    expect(summary.recent).toHaveLength(100)
  })
  it('serializes parallel stores without losing writes or counting duplicate responses twice', async () => {
    const f = await fixture()
    const second = new WorkBuddyUsageStore(f.path, 'cn', { now: () => now })
    await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? f.store : second).record(row(String(i % 20)))))
    expect((await f.store.read([account])).windows['1'].requests).toBe(20)
  })
  it('bounds an oversized observation burst at the production 5,000-entry limit', async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 5_010 }, (_, i) => f.store.record(row(String(i)))))
    const summary = await f.store.read([account])
    expect(summary.windows['1'].requests).toBe(5_000)
    expect(summary.coverage.truncated).toBe(true)
    expect((await stat(f.path)).size).toBeLessThanOrEqual(4 * 1024 * 1024)
  })
  it.each(['{broken-private-token', JSON.stringify({ version: 2 }), ' '.repeat(4 * 1024 * 1024 + 1)])('reports corrupt/oversized history without replacing it', async contents => {
    const f = await fixture()
    await writeFile(f.path, contents)
    await expect(f.store.record(row('pending'))).resolves.toBeUndefined()
    await f.store.flush()
    expect(await readFile(f.path, 'utf8')).toBe(contents)
    const summary = await f.store.read([account])
    expect(summary.status).toBe('history-invalid')
    expect(summary.persistence).toBe('unavailable')
    expect(JSON.stringify(summary)).not.toContain('private-token')
  })
  it('reports disk failure safely and retries bounded pending writes after recovery', async () => {
    const f = await fixture()
    await mkdir(f.path)
    await expect(f.store.record(row('pending'))).resolves.toBeUndefined()
    expect(await f.store.read([account])).toMatchObject({ status: 'storage-unavailable', persistence: 'unavailable' })
    await rm(f.path, { recursive: true })
    await f.store.flush()
    expect(await f.store.read([account])).toMatchObject({ status: 'available', persistence: 'persisted' })
    expect(JSON.parse(await readFile(f.path, 'utf8')).records).toHaveLength(1)
  })
  it('whitelists persisted fields and rejects raw identities, wrong regions and invalid credits', async () => {
    const f = await fixture()
    await f.store.record({ ...row('safe'), accessToken: 'private-token', uid: 'private-uid', body: 'private-body' } as UsageRecord)
    for (const invalid of [row('bad', { account: 'raw-uid:enterprise' }), row('wrong', { account: `global-${'a'.repeat(32)}` }), row('nan', { credit: NaN }), row('negative', { credit: -1 })]) await f.store.record(invalid)
    const text = await readFile(f.path, 'utf8')
    expect(text).not.toMatch(/private-|raw-uid|global-/u)
    expect(JSON.parse(text).records).toEqual([row('safe')])
  })
})
