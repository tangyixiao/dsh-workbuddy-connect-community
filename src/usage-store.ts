import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { WorkBuddyRegion } from './upstream.ts'

const DAY = 86_400_000
const MAX_RECORDS = 5_000
const MAX_BYTES = 4 * 1024 * 1024
/** Only opaque saved-account identities and passive response metadata. */
export interface UsageRecord { account: string; model: string; responseId: string; completedAt: number; credit?: number }
export interface UsageTotals { requests: number; knownCreditRequests: number; unknownCreditRequests: number; observedCredits: number }
export type UsageWindows = Record<'1' | '7' | '30', UsageTotals>
export interface UsageSummary {
  status: 'available' | 'history-invalid' | 'storage-unavailable'
  persistence: 'persisted' | 'pending' | 'unavailable'
  coverage: { retentionDays: 31; maxRecords: number; maxBytes: number; from: number | null; to: number; truncated: boolean }
  windows: UsageWindows
  byAccount: Array<{ account: string; windows: UsageWindows }>
  byModel: Array<{ model: string; windows: UsageWindows }>
  recent: UsageRecord[]
}
export interface WorkBuddyUsageStoreOptions { now?: () => number; maxRecords?: number; maxBytes?: number }
interface UsageDocument { version: 1; region: WorkBuddyRegion; truncated: boolean; records: UsageRecord[] }
class UsageStorageError extends Error {
  constructor(readonly status: 'history-invalid' | 'storage-unavailable') { super(status) }
}
function key(record: UsageRecord): string { return JSON.stringify([record.account, record.responseId]) }
function safeText(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value) }
function valid(value: unknown, region: WorkBuddyRegion): value is UsageRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row['account'] === 'string' && new RegExp(`^${region}-[a-f0-9]{32}$`, 'u').test(row['account'])
    && safeText(row['model']) && safeText(row['responseId'])
    && typeof row['completedAt'] === 'number' && Number.isSafeInteger(row['completedAt']) && row['completedAt'] >= 0
    && (row['credit'] === undefined || (typeof row['credit'] === 'number' && Number.isFinite(row['credit']) && row['credit'] >= 0 && row['credit'] <= Number.MAX_SAFE_INTEGER))
}
function copy(row: UsageRecord): UsageRecord { return { account: row.account, model: row.model, responseId: row.responseId, completedAt: row.completedAt, ...(row.credit === undefined ? {} : { credit: row.credit }) } }
function windows(records: UsageRecord[], now: number): UsageWindows {
  const result = {} as UsageWindows
  for (const days of ['1', '7', '30'] as const) {
    const totals: UsageTotals = { requests: 0, knownCreditRequests: 0, unknownCreditRequests: 0, observedCredits: 0 }
    for (const row of records) {
      if (row.completedAt < now - Number(days) * DAY || row.completedAt > now) continue
      totals.requests++
      if (row.credit === undefined) totals.unknownCreditRequests++
      else { totals.knownCreditRequests++; totals.observedCredits += row.credit }
    }
    result[days] = totals
  }
  return result
}

/** Cross-process read/merge/write under the host lock; inference never awaits disk. */
export class WorkBuddyUsageStore {
  private readonly now: () => number
  private readonly maxRecords: number
  private readonly maxBytes: number
  private readonly pending = new Map<string, UsageRecord>()
  private run: Promise<void> | undefined
  private failure: UsageSummary['status'] | undefined
  private dropped = false
  constructor(private readonly path: string, private readonly region: WorkBuddyRegion, options: WorkBuddyUsageStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.maxRecords = options.maxRecords ?? MAX_RECORDS
    this.maxBytes = options.maxBytes ?? MAX_BYTES
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1 || this.maxRecords > MAX_RECORDS || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 512 || this.maxBytes > MAX_BYTES) throw new RangeError('usage bounds invalid')
  }
  private empty(): UsageDocument { return { version: 1, region: this.region, truncated: false, records: [] } }
  private async load(): Promise<UsageDocument> {
    let text: string
    try {
      const handle = await open(this.path, 'r')
      try {
        const info = await handle.stat()
        if (!info.isFile()) throw new UsageStorageError('storage-unavailable')
        if (info.size > MAX_BYTES) throw new UsageStorageError('history-invalid')
        const bytes = Buffer.alloc(info.size + 1)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > info.size) throw new UsageStorageError('history-invalid')
        text = bytes.subarray(0, bytesRead).toString('utf8')
      } finally { await handle.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return this.empty()
      throw error instanceof UsageStorageError ? error : new UsageStorageError('storage-unavailable')
    }
    try {
      const value = JSON.parse(text) as Partial<UsageDocument> | null
      if (value === null || value.version !== 1 || value.region !== this.region || typeof value.truncated !== 'boolean' || !Array.isArray(value.records) || value.records.length > MAX_RECORDS || !value.records.every(row => valid(row, this.region))) throw new Error('invalid')
      return { version: 1, region: this.region, truncated: value.truncated, records: value.records.map(copy) }
    } catch { throw new UsageStorageError('history-invalid') }
  }
  /** Idle histories must age out on disk too; never write a lock-free snapshot. */
  private async loadRetained(): Promise<UsageDocument> {
    const observed = await this.load()
    const observedCutoff = this.now() - 31 * DAY
    if (!observed.records.some(row => row.completedAt < observedCutoff)) return observed
    return await withFileLock(this.path, async () => {
      const latest = await this.load()
      const cutoff = this.now() - 31 * DAY
      const records = latest.records.filter(row => row.completedAt >= cutoff)
      // Another writer may already have pruned; leave an unchanged file alone.
      if (records.length === latest.records.length) return latest
      const retained = { ...latest, records }
      await writeFileAtomic(this.path, `${JSON.stringify(retained)}\n`, { mode: 0o600, dirMode: 0o700 })
      return retained
    })
  }
  private bounded(document: UsageDocument, additions: Iterable<UsageRecord>): UsageDocument {
    const cutoff = this.now() - 31 * DAY
    const records = new Map<string, UsageRecord>()
    for (const row of [...document.records, ...additions]) if (row.completedAt >= cutoff && !records.has(key(row))) records.set(key(row), row)
    const sorted = [...records.values()].sort((a, b) => b.completedAt - a.completedAt || key(a).localeCompare(key(b)))
    const next: UsageDocument = { ...document, truncated: document.truncated || this.dropped || sorted.length > this.maxRecords, records: [] }
    // Count serialized UTF-8 bytes once, avoiding a quadratic stringify/pop loop.
    let bytes = Buffer.byteLength(JSON.stringify(next)) + 1
    for (const row of sorted.slice(0, this.maxRecords)) {
      const growth = Buffer.byteLength(JSON.stringify(row)) + (next.records.length > 0 ? 1 : 0)
      if (bytes + growth > this.maxBytes) { next.truncated = true; break }
      next.records.push(row); bytes += growth
    }
    return next
  }
  /** Queued records and the retry backlog are bounded; errors remain visible in read(). */
  async record(value: UsageRecord): Promise<void> {
    if (!valid(value, this.region)) return
    const id = key(value)
    if (!this.pending.has(id)) this.pending.set(id, copy(value))
    while (this.pending.size > this.maxRecords) { this.pending.delete(this.pending.keys().next().value!); this.dropped = true }
    await this.flush()
  }
  /** Explicitly retries pending writes; never overwrites a corrupt document. */
  async flush(): Promise<void> {
    if (this.run !== undefined) return this.run
    if (this.pending.size === 0) return
    this.run = Promise.resolve().then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        while (this.pending.size > 0) {
          const batch = new Map(this.pending)
          await withFileLock(this.path, async () => {
            const next = this.bounded(await this.load(), batch.values())
            await writeFileAtomic(this.path, `${JSON.stringify(next)}\n`, { mode: 0o600, dirMode: 0o700 })
          })
          for (const [id, row] of batch) if (this.pending.get(id) === row) this.pending.delete(id)
          this.failure = undefined
        }
      } catch (error) { this.failure = error instanceof UsageStorageError ? error.status : 'storage-unavailable' }
    }).finally(() => {
      this.run = undefined
      // A request can enqueue between the drain's last check and this microtask.
      if (this.pending.size > 0 && this.failure === undefined) void this.flush()
    })
    return this.run
  }
  /** Local-only retained projection. Callers supply owner-authorized account IDs. */
  async read(accounts: readonly string[]): Promise<UsageSummary> {
    while (this.run !== undefined) await this.run
    let document = this.empty()
    let status: UsageSummary['status'] = this.failure ?? 'available'
    try { document = await this.loadRetained() } catch (error) { status = error instanceof UsageStorageError ? error.status : 'storage-unavailable' }
    const bounded = this.bounded(document, this.pending.values())
    const allowed = new Set(accounts)
    const records = bounded.records.filter(row => allowed.has(row.account))
    const accountIds = [...new Set(records.map(row => row.account))].sort()
    const models = [...new Set(records.map(row => row.model))].sort()
    return {
      status, persistence: status !== 'available' ? 'unavailable' : this.pending.size > 0 ? 'pending' : 'persisted',
      coverage: { retentionDays: 31, maxRecords: this.maxRecords, maxBytes: this.maxBytes, from: records.at(-1)?.completedAt ?? null, to: this.now(), truncated: bounded.truncated },
      windows: windows(records, this.now()),
      byAccount: accountIds.map(account => ({ account, windows: windows(records.filter(row => row.account === account), this.now()) })),
      byModel: models.map(model => ({ model, windows: windows(records.filter(row => row.model === model), this.now()) })),
      recent: records.slice(0, 100).map(copy),
    }
  }
}
