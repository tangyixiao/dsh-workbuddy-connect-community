import { describe, expect, it } from 'vitest'
import { parseModelCatalog } from '../src/upstream.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'

describe('per-model context window', () => {
  it('retains CN declared tiers and switches only the selected model', () => {
    const document = { models: [
      { id: 'hy4', maxInputTokens: 960000, maxOutputTokens: 64000, contextWindow: { defaultLength: 300000, supportedLengths: [300000, 600000, 960000] } },
      { id: 'plain', maxInputTokens: 192000, maxOutputTokens: 64000 },
    ], agents: [{ name: 'cli', models: ['hy4', 'plain'] }] }
    const rows = parseModelCatalog(document, false)
    expect(rows[0]).toMatchObject({ contextWindow: 960000, supportedContextWindows: [300000, 600000, 960000] })
    const catalog = new WorkBuddyCatalog(rows)
    catalog.setContextWindows({ hy4: 600000 })
    expect(catalog.current()[0]?.contextWindow).toBe(600000)
    expect(catalog.current()[1]?.contextWindow).toBe(192000)
    catalog.setContextWindows({ hy4: 700000 })
    expect(catalog.current()[0]?.contextWindow).toBe(960000)
  })
})
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextWindowStore } from '../src/context-window-store.ts'

describe('saved context windows', () => {
  it('does not change memory if persistence fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-context-'))
    try {
      const store = new ContextWindowStore(dir)
      expect(() => store.set('a', 'hy4', 600000)).toThrow()
      expect(store.get('a')).toEqual({})
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('restores each account independently after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-context-'))
    try {
      const file = join(dir, 'windows.json')
      const store = new ContextWindowStore(file)
      store.set('account-a', 'hy4', 600000)
      store.set('account-b', 'hy4', 960000)
      const reopened = new ContextWindowStore(file)
      expect(reopened.get('account-a')).toEqual({ hy4: 600000 })
      expect(reopened.get('account-b')).toEqual({ hy4: 960000 })
      expect(reopened.get('account-c')).toEqual({})
      expect(readFileSync(file, 'utf8')).not.toContain('accessToken')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
import { mergeDesktopContextWindows, readDesktopContextProduct } from '../src/desktop-context.ts'

describe('desktop context metadata', () => {
  it('reads only a fresh personal snapshot for the requested account', () => {
    const home = mkdtempSync(join(tmpdir(), 'wb-desktop-context-'))
    try {
      const dir = join(home, '.workbuddy', 'storage', 'user-account-a-personal', 'scoped', 'one')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'wb-product-config.json')
      const product = { models: [{ id: 'hy4free' }] }
      writeFileSync(file, JSON.stringify({ 'product-config-snapshot': { data: product } }))
      expect(readDesktopContextProduct('account-a', undefined, home)).toEqual(product)
      expect(readDesktopContextProduct('account-b', undefined, home)).toBeUndefined()
      expect(readDesktopContextProduct('account-a', 'enterprise', home)).toBeUndefined()
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
      utimesSync(file, old, old)
      expect(readDesktopContextProduct('account-a', undefined, home)).toBeUndefined()
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('joins only exact model IDs with matching input caps and rejects malformed tiers', () => {
    const models = [{ id: 'hy4free', name: 'Hy4', contextWindow: 960000, maxTokens: 64000, supportsImages: true }]
    const config = { models: [{ id: 'hy4free', maxInputTokens: 960000, contextWindow: { defaultLength: 300000, supportedLengths: [300000, 600000, 960000, 2000000] } }, { id: 'hy4std', maxInputTokens: 960000, contextWindow: { supportedLengths: [300000, 960000] } }] }
    expect(mergeDesktopContextWindows(models, config)[0]).toMatchObject({ contextWindow: 960000, supportedContextWindows: [300000, 600000, 960000] })
    expect(mergeDesktopContextWindows(models, { models: [{ ...config.models[0], maxInputTokens: 1000000 }] })[0]?.supportedContextWindows).toBeUndefined()
  })
})
