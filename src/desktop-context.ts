import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkBuddyUpstreamModel } from './upstream.ts'

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Join the signed-in desktop product configuration on exact model ID and cap. */
export function mergeDesktopContextWindows(models: readonly WorkBuddyUpstreamModel[], product: unknown): readonly WorkBuddyUpstreamModel[] {
  const raw = record(product)?.['models']
  if (!Array.isArray(raw)) return models
  const byId = new Map(raw.map(record).filter((item): item is Record<string, unknown> => item !== undefined && typeof item['id'] === 'string').map(item => [item['id'], item]))
  return models.map(model => {
    if ((model.supportedContextWindows?.length ?? 0) > 1) return model
    const row = byId.get(model.id)
    const cap = model.maxInputTokens ?? model.contextWindow
    if (row?.['maxInputTokens'] !== cap) return model
    const context = record(row['contextWindow'])
    const values = context?.['supportedLengths']
    if (!Array.isArray(values)) return model
    const supported = [...new Set(values.filter((v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= cap))].sort((a, b) => a - b)
    if (supported.length < 2) return model
    const defaultLength = context?.['defaultLength']
    return { ...model, supportedContextWindows: supported, ...(typeof defaultLength === 'number' && supported.includes(defaultLength) ? { defaultContextWindow: defaultLength } : {}) }
  })
}

/** Read only a recent local desktop snapshot for this exact personal account. */
export function readDesktopContextProduct(uid: string, enterpriseId?: string, home = homedir(), now = Date.now()): unknown {
  return readDesktopContextSnapshot(uid, enterpriseId, home, now)?.product
}

/** Preserve the actual cache observation time instead of making a saved schedule look newly fetched. */
export function readDesktopContextSnapshot(uid: string, enterpriseId?: string, home = homedir(), now = Date.now()): { product: unknown; fetchedAt: number } | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(uid) || enterpriseId) return undefined
  const root = join(home, '.workbuddy', 'storage', `user-${uid}-personal`, 'scoped')
  try {
    const candidates = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).slice(0, 128)
      .map(entry => join(root, entry.name, 'wb-product-config.json'))
      .flatMap(path => { try { const s = statSync(path); return s.isFile() && s.size <= 8_000_000 && s.mtimeMs <= now + 5000 && now - s.mtimeMs < 24 * 60 * 60 * 1000 ? [{ path, time: s.mtimeMs }] : [] } catch { return [] } })
      .sort((a, b) => b.time - a.time)
    const file = candidates[0]
    if (file === undefined) return undefined
    const snapshot = record(record(JSON.parse(readFileSync(file.path, 'utf8')))?.['product-config-snapshot'])
    return snapshot?.['data'] === undefined ? undefined : { product: snapshot['data'], fetchedAt: file.time }
  } catch { return undefined }
}
