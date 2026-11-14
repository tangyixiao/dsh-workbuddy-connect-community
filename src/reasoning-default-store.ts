import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkBuddyEffort } from './upstream.ts'

const EFFORTS = new Set<string>(['low', 'medium', 'high', 'xhigh', 'max'])
export function isWorkBuddyEffort(value: unknown): value is WorkBuddyEffort {
  return typeof value === 'string' && EFFORTS.has(value)
}

/** Per-variant file, per-account/model choices. Durable writes precede memory. */
export class ReasoningDefaultStore {
  private accounts: Record<string, Record<string, WorkBuddyEffort>> = Object.create(null) as Record<string, Record<string, WorkBuddyEffort>>
  constructor(private readonly path: string) {
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return
      for (const [account, models] of Object.entries(data)) {
        if (typeof models !== 'object' || models === null || Array.isArray(models)) continue
        const valid: Record<string, WorkBuddyEffort> = Object.create(null) as Record<string, WorkBuddyEffort>
        for (const [model, effort] of Object.entries(models)) if (isWorkBuddyEffort(effort)) valid[model] = effort
        this.accounts[account] = valid
      }
    } catch { /* absent or invalid preferences use upstream/host defaults */ }
  }
  get(account: string, model: string): WorkBuddyEffort | undefined { return this.accounts[account]?.[model] }
  set(account: string, model: string, effort: WorkBuddyEffort | undefined): void {
    if (!account.trim() || !model.trim() || (effort !== undefined && !isWorkBuddyEffort(effort))) throw new Error('invalid reasoning default')
    const models = { ...this.accounts[account] }
    if (effort === undefined) delete models[model]
    else models[model] = effort
    const next = { ...this.accounts, [account]: models }
    if (Object.keys(models).length === 0) delete next[account]
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
      renameSync(temp, this.path)
    } finally { rmSync(temp, { force: true }) }
    this.accounts = next
  }
}
