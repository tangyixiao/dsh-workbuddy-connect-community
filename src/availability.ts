export interface WorkBuddyAvailability {
  kind: 'model_busy' | 'queue'
  source: 'response'
  observedAt: number
  expiresAt: number
  code?: number
  retryAt?: number
}

/** Passive, short-lived observations only; absence never means healthy. */
export class WorkBuddyAvailabilityStore {
  private readonly entries = new Map<string, WorkBuddyAvailability>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly limit: number
  constructor(options: { now?: () => number; ttlMs?: number; limit?: number } = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? 120_000
    this.limit = options.limit ?? 100
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error('invalid availability bounds')
  }
  record(scope: string, model: string, kind: string, code?: number, retryAt?: number): void {
    if (!scope || !model || model.length > 256 || (kind !== 'model_busy' && kind !== 'queue')) return
    const observedAt = this.now()
    const key = `${scope}\0${model}`
    this.entries.delete(key)
    this.entries.set(key, { kind, source: 'response', observedAt, expiresAt: observedAt + this.ttlMs,
      ...(code === undefined ? {} : { code }),
      ...(retryAt === undefined || !Number.isFinite(retryAt) || retryAt <= observedAt ? {} : { retryAt }),
    })
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
  }
  get(scope: string, model: string): WorkBuddyAvailability | undefined {
    const key = `${scope}\0${model}`
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    if (this.now() >= value.expiresAt) { this.entries.delete(key); return undefined }
    return { ...value }
  }
  success(scope: string, model: string): void { this.entries.delete(`${scope}\0${model}`) }
  clear(): void { this.entries.clear() }
}

/** Absolute observed retry time from the HTTP header, never a guessed delay. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const text = value.trim()
  const at = /^\d+$/u.test(text) ? now + Number(text) * 1000 : /^[A-Za-z]{3}, /u.test(text) ? Date.parse(text) : Number.NaN
  return Number.isFinite(at) && at > now && at <= now + 24 * 60 * 60 * 1000 ? at : undefined
}
