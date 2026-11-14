import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyCredentialStore, type WorkBuddyCredential } from '../src/auth.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'
import { run } from '../src/bin.ts'
import { WorkBuddyAccountStore, WorkBuddyAccountError } from '../src/account-store.ts'

const owned: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function desktop(uid: string, expiresAt = Date.now() + 3_600_000, domain = 'www.codebuddy.cn'): string {
  return JSON.stringify({ auth: { accessToken: `secret-access-${uid}`, refreshToken: `secret-refresh-${uid}`, expiresAt, domain }, account: { uid, enterpriseId: 'enterprise' } })
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'workbuddy-manual-'))
  owned.push(dir)
  const desktopPath = join(dir, 'desktop.json')
  const ownPath = join(dir, 'own.json')
  await writeFile(desktopPath, desktop('a'))
  const refresh = vi.fn(async (_credential: WorkBuddyCredential) => ({ accessToken: 'refreshed-secret', expiresInSec: 3600 }))
  const make = () => new WorkBuddyCredentialStore({ variant: CN_VARIANT, desktopPath, ownPath, refresh })
  return { dir, desktopPath, ownPath, accountsPath: `${ownPath}.accounts.json`, refresh, make, store: make() }
}

describe('explicit manual accounts', () => {
  it.each(['selected-first', 'saved-first'] as const)('shares one refresh between selected chat and saved-member reads: %s', async order => {
    const f = await fixture()
    await writeFile(f.desktopPath, desktop('a', Date.now() - 60_000))
    const saved = await f.store.saveCurrentAccount()
    await f.store.selectAccount(saved.id)
    const capture = await f.store.accountSnapshot()
    let release!: (value: { accessToken: string; expiresInSec: number }) => void
    let started!: () => void
    const ready = new Promise<void>(done => { started = done })
    const upstream = new Promise<{ accessToken: string; expiresInSec: number }>(done => { release = done })
    f.refresh.mockImplementation(async () => { started(); return await upstream })
    const first = order === 'selected-first' ? f.store.resolve() : f.store.resolveSavedAccount(saved.id, capture)
    await ready
    let entered!: () => void
    const captured = new Promise<void>(done => { entered = done })
    if (order === 'selected-first') {
      const read = WorkBuddyAccountStore.prototype.saved
      vi.spyOn(WorkBuddyAccountStore.prototype, 'saved').mockImplementationOnce(async function (this: WorkBuddyAccountStore, ...args) { const value = await read.apply(this, args); entered(); return value })
    } else {
      const read = WorkBuddyAccountStore.prototype.selection
      vi.spyOn(WorkBuddyAccountStore.prototype, 'selection').mockImplementationOnce(async function (this: WorkBuddyAccountStore, ...args) { const value = await read.apply(this, args); entered(); return value })
    }
    const second = order === 'selected-first' ? f.store.resolveSavedAccount(saved.id, capture) : f.store.resolve()
    const settled = Promise.allSettled([first, second])
    await captured
    await new Promise<void>(done => { setImmediate(done) })
    release({ accessToken: 'one-refreshed-secret', expiresInSec: 3600 })
    const results = await settled
    expect(f.refresh).toHaveBeenCalledTimes(1)
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
    for (const result of results) if (result.status === 'fulfilled') expect(result.value.accessToken).toBe('one-refreshed-secret')
    expect((await f.store.current())?.accessToken).toBe('one-refreshed-secret')
    await expect(readFile(f.ownPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('saves stable secret-free identities without opting in, and persists selection', async () => {
    const f = await fixture()
    const saved = await f.store.saveCurrentAccount()
    expect(await f.store.saveCurrentAccount()).toEqual(saved)
    expect(saved.id).toMatch(/^cn-[a-f0-9]{32}$/u)
    expect(JSON.stringify(await f.store.listAccounts())).not.toContain('secret')
    const desktopB = desktop('b')
    await writeFile(f.desktopPath, desktopB)
    expect((await f.store.current())?.uid).toBe('b')
    await f.store.selectAccount(saved.id)
    expect((await f.make().current())?.uid).toBe('a')
    expect((await f.store.listAccounts()).mode).toBe('saved-account')
    await f.store.followDesktop()
    expect((await f.make().current())?.uid).toBe('b')
    expect(await readFile(f.desktopPath, 'utf8')).toBe(desktopB)
    if (process.platform !== 'win32') expect((await stat(f.accountsPath)).mode & 0o777).toBe(0o600)
  })

  it('refuses wrong region and unknown accounts without changing selection', async () => {
    const f = await fixture()
    const saved = await f.store.saveCurrentAccount()
    await f.store.selectAccount(saved.id)
    await expect(f.store.selectAccount('global-' + 'a'.repeat(32))).rejects.toThrow('account-not-found')
    expect((await f.store.current())?.uid).toBe('a')
    const other = new WorkBuddyCredentialStore({ variant: AI_VARIANT, desktopPath: f.desktopPath, ownPath: f.ownPath, refresh: f.refresh })
    await expect(other.listAccounts()).rejects.toThrow('account-state-invalid')
    await writeFile(f.desktopPath, desktop('global', Date.now() + 3600_000, 'workbuddy.ai'))
    await f.store.followDesktop()
    await expect(f.store.saveCurrentAccount()).rejects.toThrow()
  })

  it('fails closed on missing selected snapshot and corrupt or oversized state', async () => {
    const f = await fixture()
    const saved = await f.store.saveCurrentAccount()
    await f.store.selectAccount(saved.id)
    const document = JSON.parse(await readFile(f.accountsPath, 'utf8'))
    document.accounts = []
    await writeFile(f.accountsPath, JSON.stringify(document))
    await expect(f.store.current()).rejects.toThrow('account-state-invalid')
    await writeFile(f.accountsPath, 'broken secret-access-a')
    await expect(f.store.current()).rejects.toThrow('account-state-invalid')
    await writeFile(f.accountsPath, 'x'.repeat(1_048_577))
    await expect(f.store.listAccounts()).rejects.toThrow('account-state-invalid')
  })

  it('does not share an old account refresh with a newly selected account', async () => {
    const f = await fixture()
    await writeFile(f.desktopPath, desktop('a', Date.now() + 60_000))
    const a = await f.store.saveCurrentAccount()
    await writeFile(f.desktopPath, desktop('b', Date.now() + 60_000))
    const b = await f.store.saveCurrentAccount()
    await f.store.selectAccount(a.id)
    let complete!: (value: { accessToken: string; expiresInSec: number }) => void
    const started = new Promise<void>(resolve => {
      f.refresh.mockImplementationOnce(() => { resolve(); return new Promise(done => { complete = done }) })
    })
    const pending = f.store.resolve().then(value => value, error => error)
    await started
    await f.make().selectAccount(b.id)
    expect((await f.store.resolve()).uid).toBe('b')
    complete({ accessToken: 'old-account-refreshed-secret', expiresInSec: 3600 })
    expect(await pending).toMatchObject({ message: expect.stringContaining('account-selection-changed') })
    expect((await f.make().current())?.uid).toBe('b')
    expect(await readFile(f.accountsPath, 'utf8')).not.toContain('old-account-refreshed-secret')
  })

  it('refuses a refreshed credential from another region without changing saved tokens', async () => {
    const f = await fixture()
    await writeFile(f.desktopPath, desktop('a', Date.now() - 60_000))
    const saved = await f.store.saveCurrentAccount()
    await f.store.selectAccount(saved.id)
    f.refresh.mockResolvedValueOnce({ accessToken: 'wrong-region-secret', expiresInSec: 3600, domain: 'workbuddy.ai' } as never)
    await expect(f.store.resolve()).rejects.toThrow('account-region-mismatch')
    expect((await f.store.current())?.accessToken).toBe('secret-access-a')
    expect(await readFile(f.accountsPath, 'utf8')).not.toContain('wrong-region-secret')
  })

  it('does not commit a desktop-follow refresh after a separate store selects a saved account', async () => {
    const f = await fixture()
    const a = await f.store.saveCurrentAccount()
    await writeFile(f.desktopPath, desktop('b', Date.now() + 60_000))
    let complete!: (value: { accessToken: string; expiresInSec: number }) => void
    const started = new Promise<void>(resolve => {
      f.refresh.mockImplementationOnce(() => { resolve(); return new Promise(done => { complete = done }) })
    })
    const pending = f.store.resolve().then(value => value, error => error)
    await started
    await f.make().selectAccount(a.id)
    complete({ accessToken: 'desktop-b-refreshed-secret', expiresInSec: 3600 })
    expect(await pending).toMatchObject({ message: expect.stringContaining('account-selection-changed') })
    expect((await f.store.current())?.uid).toBe('a')
    await expect(readFile(f.ownPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refreshes only the selected snapshot and ignores unreadable desktop state', async () => {
    const f = await fixture()
    await writeFile(f.desktopPath, desktop('a', Date.now() - 60_000))
    const a = await f.store.saveCurrentAccount()
    await writeFile(f.desktopPath, desktop('b'))
    const b = await f.store.saveCurrentAccount()
    await f.store.selectAccount(a.id)
    await writeFile(f.desktopPath, 'broken-desktop-data')
    expect((await f.store.resolve()).accessToken).toBe('refreshed-secret')
    expect(f.refresh.mock.calls[0]?.[0]).toMatchObject({ uid: 'a' })
    expect((await f.make().current())?.accessToken).toBe('refreshed-secret')
    await f.store.selectAccount(b.id)
    expect((await f.store.current())?.accessToken).toBe('secret-access-b')
    expect(await readFile(f.desktopPath, 'utf8')).toBe('broken-desktop-data')
    await expect(readFile(f.ownPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a refresh committed after save-current captured its stale credential', async () => {
    const f = await fixture()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await writeFile(f.desktopPath, desktop('a', now + 60_000))
    // Equal expiry proves protection comes from the capture, not expiry order.
    f.refresh.mockResolvedValueOnce({ accessToken: 'refreshed-secret', expiresInSec: 60 })
    const a = await f.store.saveCurrentAccount()
    await f.store.selectAccount(a.id)
    const originalSave = WorkBuddyAccountStore.prototype.save
    const writer = new WorkBuddyAccountStore(f.accountsPath, 'cn')
    vi.spyOn(WorkBuddyAccountStore.prototype, 'save').mockImplementationOnce(async (...args) => {
      // save-current already read the old snapshot; another request commits first.
      await f.make().resolve()
      return await originalSave.apply(writer, args)
    })
    await f.store.saveCurrentAccount()
    expect((await f.make().current())?.accessToken).toBe('refreshed-secret')
    expect((await f.make().current())?.expiresAtMs).toBe(now + 60_000)
  })

  it('retains a still-valid desktop token if the refresh copy cannot be written', async () => {
    const f = await fixture()
    await writeFile(f.desktopPath, desktop('a', Date.now() + 60_000))
    // An existing directory prevents committing the plugin-owned refresh file.
    await mkdir(f.ownPath)
    expect((await f.store.resolve()).accessToken).toBe('secret-access-a')
    expect(f.refresh).toHaveBeenCalledOnce()
  })

  it('refuses token fallback after a storage failure when the durable selection changed', async () => {
    const f = await fixture()
    await writeFile(f.desktopPath, desktop('a', Date.now() + 60_000))
    const a = await f.store.saveCurrentAccount()
    vi.spyOn(WorkBuddyAccountStore.prototype, 'commitRefresh').mockImplementationOnce(async () => {
      await f.make().selectAccount(a.id)
      throw new WorkBuddyAccountError('account-storage-unavailable')
    })
    await expect(f.store.resolve()).rejects.toThrow('account-selection-changed')
  })

  it('rejects malformed provider flags without changing either region account state', async () => {
    const f = await fixture()
    vi.stubEnv('DSH_HOME', f.dir)
    vi.stubEnv('WORKBUDDY_AUTH_FILE', f.desktopPath)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const cnPath = join(f.dir, CN_VARIANT.ownFilename) + '.accounts.json'
    const aiPath = join(f.dir, AI_VARIANT.ownFilename) + '.accounts.json'
    const cn = new WorkBuddyCredentialStore({ variant: CN_VARIANT, desktopPath: f.desktopPath, ownPath: join(f.dir, CN_VARIANT.ownFilename), refresh: f.refresh })
    const saved = await cn.saveCurrentAccount()
    await cn.selectAccount(saved.id)
    const before = await readFile(cnPath, 'utf8')
    for (const flags of [['--provider'], ['--provider', '--json'], ['--provider='], ['--provider', 'workbuddy', '--provider', 'workbuddy-ai']]) {
      expect(await run(['accounts', 'follow-desktop', ...flags])).toBe(1)
      expect(await readFile(cnPath, 'utf8')).toBe(before)
      await expect(readFile(aiPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('supports offline CLI operations with bounded JSON output and generic errors', async () => {
    const f = await fixture()
    vi.stubEnv('DSH_HOME', f.dir)
    vi.stubEnv('WORKBUDDY_AUTH_FILE', f.desktopPath)
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const errors = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await run(['accounts', 'save-current', '--json'])).toBe(0)
    const saved = JSON.parse(String(output.mock.calls.at(-1)?.[0])).account
    expect(await run(['accounts', 'select', saved.id, '--json'])).toBe(0)
    expect(await run(['accounts', 'list', '--json'])).toBe(0)
    expect(String(output.mock.calls.at(-1)?.[0])).toContain('saved-account')
    expect(await run(['accounts', 'follow-desktop', '--json'])).toBe(0)
    expect(await run(['accounts', 'select', 'secret-input-token', '--json'])).toBe(1)
    expect(output.mock.calls.flat().join('')).not.toContain('secret')
    expect(errors.mock.calls.flat().join('')).not.toContain('secret')
  })
})
