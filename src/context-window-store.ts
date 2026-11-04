import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Per-variant, per-account context choices. Persist before changing memory. */
export class ContextWindowStore {
  private accounts: Record<string, Record<string, number>> = Object.create(null) as Record<string, Record<string, number>>
  constructor(private readonly path: string) {
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return
      for (const [account, value] of Object.entries(data)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
        const valid: Record<string, number> = Object.create(null) as Record<string, number>
        for (const [model, window] of Object.entries(value)) if (Number.isSafeInteger(window) && (window as number) > 0) valid[model] = window as number
        this.accounts[account] = valid
      }
    } catch { /* missing or invalid state */ }
  }
  get(account: string): Readonly<Record<string, number>> { return { ...this.accounts[account] } }
  set(account: string, model: string, window: number): void {
    const next = { ...this.accounts, [account]: { ...this.accounts[account], [model]: window } }
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 })
    renameSync(temp, this.path)
    this.accounts = next
  }
}
