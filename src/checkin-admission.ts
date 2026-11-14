/** Durable admission before a non-idempotent check-in write; never schedules or sends requests. */
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { WorkBuddyRegion } from './upstream.ts'
import { toolkitAccountIdValid } from './toolkit-settings.ts'

export type CheckinOutcome = 'unknown' | 'succeeded' | 'failed'
interface Admission { outcome: CheckinOutcome; admittedAtMs: number }
interface Document { version: 1; region: WorkBuddyRegion; admissions: Record<string, Admission> }
export class CheckinAdmissionError extends Error {
  constructor(readonly code: 'checkin-input-invalid' | 'checkin-state-invalid' | 'checkin-not-admitted' | 'checkin-storage-unavailable') { super(code) }
}
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_BYTES = 1_048_576
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day
}
function validNonce(nonce: string): boolean { return /^[a-zA-Z0-9_-]{16,128}$/u.test(nonce) }
/** The caller labels HTTP Date UTC boundaries conservatively; they are not a claimed billing timezone. */
export class CheckinAdmissionStore {
  private readonly now: () => number
  constructor(private readonly path: string, private readonly region: WorkBuddyRegion, options: { now?: () => number } = {}) { this.now = options.now ?? Date.now }
  private key(account: string, boundary: string, manual: boolean): string {
    if (!toolkitAccountIdValid(account, this.region) || !(manual ? validNonce(boundary) : validDay(boundary))) throw new CheckinAdmissionError('checkin-input-invalid')
    return `${account}:${manual ? 'manual' : 'day'}:${boundary}`
  }
  private async read(): Promise<Document> {
    try {
      const handle = await open(this.path, 'r')
      let text: string
      try {
        const size = (await handle.stat()).size
        if (size > MAX_BYTES) throw new CheckinAdmissionError('checkin-state-invalid')
        const bytes = Buffer.alloc(size + 1)
        const read = await handle.read(bytes, 0, bytes.length, 0)
        if (read.bytesRead > size) throw new CheckinAdmissionError('checkin-state-invalid')
        text = bytes.subarray(0, read.bytesRead).toString('utf8')
      } finally { await handle.close() }
      const value: unknown = JSON.parse(text)
      if (!record(value) || value['version'] !== 1 || value['region'] !== this.region || !record(value['admissions']) || Object.keys(value['admissions']).length > 4096) throw new CheckinAdmissionError('checkin-state-invalid')
      for (const [key, admission] of Object.entries(value['admissions'])) {
        const [account, kind, boundary, extra] = key.split(':')
        if (extra !== undefined || account === undefined || boundary === undefined || !toolkitAccountIdValid(account, this.region)
          || !(kind === 'day' ? validDay(boundary) : kind === 'manual' && validNonce(boundary))
          || !record(admission) || !['unknown', 'succeeded', 'failed'].includes(admission['outcome'] as string)
          || typeof admission['admittedAtMs'] !== 'number' || !Number.isSafeInteger(admission['admittedAtMs']) || admission['admittedAtMs'] < 0) throw new CheckinAdmissionError('checkin-state-invalid')
      }
      return value as unknown as Document
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: 1, region: this.region, admissions: {} }
      throw error instanceof CheckinAdmissionError ? error : new CheckinAdmissionError('checkin-state-invalid')
    }
  }
  private async mutate<T>(operation: (document: Document) => T): Promise<T> {
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      return await withFileLock(this.path, async () => {
        const document = await this.read()
        const result = operation(document)
        const text = `${JSON.stringify(document)}\n`
        if (Buffer.byteLength(text) > MAX_BYTES || Object.keys(document.admissions).length > 4096) throw new CheckinAdmissionError('checkin-state-invalid')
        await writeFileAtomic(this.path, text, { mode: 0o600, dirMode: 0o700 })
        return result
      })
    } catch (error) { throw error instanceof CheckinAdmissionError ? error : new CheckinAdmissionError('checkin-storage-unavailable') }
  }
  private async admitKey(account: string, key: string): Promise<boolean> {
    return await this.mutate(document => {
      if (document.admissions[key] !== undefined) return false
      const now = this.now()
      if (!Number.isSafeInteger(now) || now < 0) throw new CheckinAdmissionError('checkin-input-invalid')
      // Any attempt, even uncertain/failed/manual, reserves a rolling day. Clock rollback also blocks.
      if (Object.entries(document.admissions).some(([previousKey, admission]) => previousKey.startsWith(`${account}:`) && now - admission.admittedAtMs < DAY_MS)) return false
      document.admissions[key] = { outcome: 'unknown', admittedAtMs: now }
      return true
    })
  }
  async admit(account: string, day: string): Promise<boolean> { return await this.admitKey(account, this.key(account, day, false)) }
  async admitManual(account: string, nonce: string): Promise<boolean> { return await this.admitKey(account, this.key(account, nonce, true)) }
  private async completeKey(key: string, outcome: CheckinOutcome): Promise<void> {
    if (!['unknown', 'succeeded', 'failed'].includes(outcome)) throw new CheckinAdmissionError('checkin-input-invalid')
    await this.mutate(document => {
      const previous = document.admissions[key]
      if (previous === undefined) throw new CheckinAdmissionError('checkin-not-admitted')
      if (previous.outcome !== 'succeeded') previous.outcome = outcome
    })
  }
  async complete(account: string, day: string, outcome: CheckinOutcome): Promise<void> { await this.completeKey(this.key(account, day, false), outcome) }
  async completeManual(account: string, nonce: string, outcome: CheckinOutcome): Promise<void> { await this.completeKey(this.key(account, nonce, true), outcome) }
  async get(account: string, day: string): Promise<{ outcome: CheckinOutcome } | undefined> {
    const key = this.key(account, day, false)
    const value = (await this.read()).admissions[key]
    return value === undefined ? undefined : { outcome: value.outcome }
  }
  async getManual(account: string, nonce: string): Promise<{ outcome: CheckinOutcome } | undefined> {
    const key = this.key(account, nonce, true)
    const value = (await this.read()).admissions[key]
    return value === undefined ? undefined : { outcome: value.outcome }
  }
}
