import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyCredentialStore, type WorkBuddyCredential } from '../src/auth.ts'
import { CN_VARIANT } from '../src/variants.ts'
import { ToolkitSettingsStore } from '../src/toolkit-settings.ts'
import { WorkBuddyAccountPolicy } from '../src/account-policy.ts'
import { CheckinAdmissionStore } from '../src/checkin-admission.ts'
import { WorkBuddyElectronPathError } from '../src/desktop-credential-protection.ts'
import { workBuddyWebStatus } from '../src/web-status.ts'

const owned: string[] = []
afterEach(async () => { await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function directory() {
  const parent = join(process.cwd(), 'work', 'all-features-20261113', 'automation-tests')
  await mkdir(parent, { recursive: true })
  const path = await mkdtemp(join(parent, 'fixture-'))
  owned.push(path)
  return path
}
function credential(uid: string): WorkBuddyCredential {
  return { uid, domain: 'www.codebuddy.cn', source: 'dsh', accessToken: `private-access-${uid}`, refreshToken: `private-refresh-${uid}`, expiresAtMs: Date.now() + 3_600_000 }
}
async function accounts(expiresB = Date.now() + 3_600_000) {
  const dir = await directory()
  const desktopPath = join(dir, 'desktop.json')
  const ownPath = join(dir, 'own.json')
  const writeDesktop = async (uid: string, expiresAt = Date.now() + 3_600_000) => {
    await writeFile(desktopPath, JSON.stringify({ auth: { accessToken: `private-access-${uid}`, refreshToken: `private-refresh-${uid}`, expiresAt, domain: 'www.codebuddy.cn' }, account: { uid } }))
  }
  await writeDesktop('a')
  const base = new WorkBuddyCredentialStore({ variant: CN_VARIANT, desktopPath, ownPath, refresh: async value => ({ accessToken: `new-${value.uid}`, expiresInSec: 3600 }) })
  const a = await base.saveCurrentAccount()
  await writeDesktop('b', expiresB)
  const b = await base.saveCurrentAccount()
  await writeDesktop('c')
  const c = await base.saveCurrentAccount()
  await base.selectAccount(a.id)
  return { dir, base, a, b, c, writeDesktop, ownPath, desktopPath }
}

describe('durable toolkit owner settings', () => {
  const id = 'cn-' + 'a'.repeat(32)
  it('defaults off and isolates accounts and providers', async () => {
    const path = join(await directory(), 'settings.json')
    const store = new ToolkitSettingsStore(path, 'cn')
    const value = await store.get(id)
    expect(value.features).toEqual({ images: false, videos: false, cli: false, contextRescue: false })
    expect(value.automation).toEqual({ rotate: false, checkin: false, members: [], maxSwitches: 1 })
    await store.update(id, { features: { images: true } }, value.revision)
    expect((await new ToolkitSettingsStore(path, 'cn').get(id)).features.images).toBe(true)
    expect((await store.get('cn-' + 'b'.repeat(32))).features.images).toBe(false)
    await expect(new ToolkitSettingsStore(path, 'global').get(id)).rejects.toThrow('toolkit-account-invalid')
  })
  it('serializes racing revision writes and rejects unknown or unsafe configuration', async () => {
    const store = new ToolkitSettingsStore(join(await directory(), 'settings.json'), 'cn')
    const initial = await store.get(id)
    const results = await Promise.allSettled([
      store.update(id, { features: { images: true } }, initial.revision),
      store.update(id, { features: { videos: true } }, initial.revision),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    for (const patch of [{ features: { unknown: true } }, { automation: { maxSwitches: 4 } }, { automation: { members: ['global-' + 'b'.repeat(32)] } }, { cli: { workspace: '../escape' } }, { cli: { executable: 'bad' } }, { cli: { maxTurns: 9 } }, { cli: { timeoutMs: 9999 } }, { features: { cli: true } }]) {
      await expect(store.update(id, patch, (await store.get(id)).revision)).rejects.toThrow('toolkit-settings-invalid')
    }
  })
  it('does not enable a feature in memory when durable write fails', async () => {
    const dir = await directory()
    const path = join(dir, 'settings.json')
    const store = new ToolkitSettingsStore(path, 'cn')
    const initial = await store.get(id)
    await mkdir(path)
    await expect(store.update(id, { features: { images: true } }, initial.revision)).rejects.toThrow()
    await rm(path, { recursive: true })
    expect((await store.get(id)).features.images).toBe(false)
  })
  it('accepts bounded owner CLI configuration without accepting a model-selected executable', async () => {
    const dir = await directory()
    const store = new ToolkitSettingsStore(join(dir, 'settings.json'), 'cn')
    const value = await store.update(id, { features: { cli: true }, cli: { workspace: dir, model: 'model-a', effort: 'high', timeoutMs: 10000, maxTurns: 1 } }, (await store.get(id)).revision)
    expect(value.features.cli).toBe(true)
    expect(value.cli.workspace).toBe(dir)
    expect(JSON.stringify(value)).not.toContain('private-access')
  })
  it('fails closed on corrupt state and rejects explicit undefined or prototype patches', async () => {
    const path = join(await directory(), 'settings.json')
    const store = new ToolkitSettingsStore(path, 'cn')
    const revision = (await store.get(id)).revision
    await expect(store.update(id, { features: undefined }, revision)).rejects.toThrow('toolkit-settings-invalid')
    await expect(store.update(id, Object.create({ features: { images: true } }), revision)).rejects.toThrow('toolkit-settings-invalid')
    await writeFile(path, JSON.stringify({ version: 1, region: 'cn', accounts: { [id]: { features: { images: true } } } }))
    await expect(store.get(id)).rejects.toThrow('toolkit-state-invalid')
  })
  it('requires runner-supported effort and turn bounds before CLI can be enabled', async () => {
    const dir = await directory()
    const store = new ToolkitSettingsStore(join(dir, 'settings.json'), 'cn')
    let value = await store.update(id, { cli: { workspace: dir, model: 'vendor/model', effort: '' } }, (await store.get(id)).revision)
    await expect(store.update(id, { features: { cli: true } }, value.revision)).rejects.toThrow('toolkit-settings-invalid')
    await expect(store.update(id, { cli: { maxTurns: 5 } }, value.revision)).rejects.toThrow('toolkit-settings-invalid')
    value = await store.update(id, { cli: { effort: 'high', maxTurns: 4 }, features: { cli: true } }, value.revision)
    expect(value.cli.model).toBe('vendor/model')
    await expect(store.update(id, { cli: { effort: 'off' } }, value.revision)).rejects.toThrow('toolkit-settings-invalid')
  })
})

describe('scoped saved accounts and owner control revisions', () => {
  it('exposes an opaque durable control revision and rejects stale controls', async () => {
    const f = await accounts()
    const before = await f.base.listAccounts()
    expect(typeof before.revision).toBe('string')
    await f.base.renameAccount(f.b.id, 'Second account', before.revision)
    await expect(f.base.selectAccount(f.b.id, before.revision)).rejects.toThrow('account-selection-changed')
    const after = await f.base.listAccounts()
    expect(after.accounts.find(value => value.id === f.b.id)?.label).toBe('Second account')
    await expect(f.base.removeAccount(f.a.id, after.revision)).rejects.toThrow('account-selected')
    expect((await f.base.current())?.uid).toBe('a')
    await f.base.removeAccount(f.b.id, after.revision)
    expect((await f.base.listAccounts()).accounts).toHaveLength(2)
  })
  it('resolves a saved credential without changing manual selection and rejects stale snapshots', async () => {
    const f = await accounts()
    const capture = await f.base.accountSnapshot()
    expect((await f.base.resolveSavedAccount(f.b.id, capture)).uid).toBe('b')
    expect((await f.base.current())?.uid).toBe('a')
    await f.base.selectAccount(f.c.id)
    await expect(f.base.resolveSavedAccount(f.b.id, capture)).rejects.toThrow('account-selection-changed')
    expect((await f.base.current())?.uid).toBe('c')
  })
  it('rejects stale save/follow/remove controls and unbounded labels before mutating state', async () => {
    const f = await accounts()
    const old = (await f.base.listAccounts()).revision
    await f.base.renameAccount(f.b.id, 'Backup', old)
    for (const action of [() => f.base.saveCurrentAccount(old), () => f.base.followDesktop(old), () => f.base.removeAccount(f.b.id, old)]) await expect(action()).rejects.toThrow('account-selection-changed')
    for (const label of ['', ' '.repeat(2), 'x'.repeat(81), 'private\nlabel']) await expect(f.base.renameAccount(f.b.id, label)).rejects.toThrow('account-label-invalid')
    expect((await f.base.current())?.uid).toBe('a')
    expect((await f.base.listAccounts()).accounts).toHaveLength(3)
  })
  it('does not persist a saved-member refresh if owner controls change during its upstream call', async () => {
    const f = await accounts(Date.now() - 60_000)
    let finish!: (value: { accessToken: string; expiresInSec: number }) => void
    let started!: () => void
    const ready = new Promise<void>(done => { started = done })
    const slow = new WorkBuddyCredentialStore({ variant: CN_VARIANT, desktopPath: f.desktopPath, ownPath: f.ownPath, refresh: async () => { started(); return await new Promise(resolve => { finish = resolve }) } })
    const pending = slow.resolveSavedAccount(f.b.id, await f.base.accountSnapshot()).then(value => value, error => error)
    await ready
    await f.base.renameAccount(f.b.id, 'Changed consent')
    finish({ accessToken: 'must-not-persist', expiresInSec: 3600 })
    expect(await pending).toMatchObject({ message: expect.stringContaining('account-selection-changed') })
    expect(await readFile(`${f.ownPath}.accounts.json`, 'utf8')).not.toContain('must-not-persist')
    expect((await f.base.current())?.uid).toBe('a')
  })
  it('does not overwrite rotated saved tokens from a second concurrent refresh', async () => {
    const f = await accounts(Date.now() - 60_000)
    const original = await f.base.accountSnapshot()
    let finish!: (value: { accessToken: string; expiresInSec: number }) => void
    let started!: () => void
    const ready = new Promise<void>(done => { started = done })
    const slow = new WorkBuddyCredentialStore({ variant: CN_VARIANT, desktopPath: f.desktopPath, ownPath: f.ownPath, refresh: async () => { started(); return await new Promise(resolve => { finish = resolve }) } })
    const pending = slow.resolveSavedAccount(f.b.id, original).then(value => value, error => error)
    await ready
    expect((await f.base.resolveSavedAccount(f.b.id, original)).accessToken).toBe('new-b')
    finish({ accessToken: 'stale-rotated-token', expiresInSec: 3600 })
    expect(await pending).toMatchObject({ message: expect.stringContaining('account-selection-changed') })
    expect(await readFile(`${f.ownPath}.accounts.json`, 'utf8')).not.toContain('stale-rotated-token')
  })
})

describe('next independent request account policy', () => {
  it.each(['electron-binary-not-found', 'electron-binary-ambiguous'] as const)('preserves recognized discovery recovery codes without exporting error text: %s', async code => {
    const f = await accounts()
    const discovery = vi.spyOn(f.base, 'accountSnapshot').mockRejectedValue(new WorkBuddyElectronPathError(code, 'private-path-and-token'))
    try {
      const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: () => new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn').get(f.a.id) })
      const fetchCredits = vi.fn()
      const status = await workBuddyWebStatus({ store: policy.credentialView(), client: { fetchCredits }, models: () => [] })
      expect(status).toEqual({ status: 'signed-out', reasonCode: code })
      expect(fetchCredits).not.toHaveBeenCalled()
    } finally { discovery.mockRestore() }
  })

  it.each([new Error('private-path-and-token'), { reasonCode: 'electron-binary-not-found', message: 'private-path-and-token' }])('does not export arbitrary errors or accept unrecognized diagnostic carriers', async failure => {
    const f = await accounts()
    const discovery = vi.spyOn(f.base, 'accountSnapshot').mockRejectedValue(failure)
    try {
      const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: () => new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn').get(f.a.id) })
      expect(await policy.credentialView().status()).toEqual({ state: 'signed-out' })
    } finally { discovery.mockRestore() }
  })

  it('stays off by default and ignores non-credit failures without refreshing or switching', async () => {
    const f = await accounts()
    const store = new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn')
    const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: primary => store.get(f.base.accountId(primary)) })
    for (const kind of ['hard_credit', 'policy', 'channel', 'model-busy', 'queue', 'network']) {
      policy.observeFailure(kind, (await policy.resolve()))
      expect((await policy.resolve()).uid).toBe('a')
    }
    expect(policy.decision()).toEqual({ state: 'disabled', switches: 0 })
  })
  it('arms only confirmed hard credit and switches on resolve without replay or global selection changes', async () => {
    const f = await accounts()
    const store = new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn')
    const aid = f.base.accountId((await f.base.current())!)
    await store.update(aid, { automation: { rotate: true, members: [f.b.id, f.c.id], maxSwitches: 1 } }, (await store.get(aid)).revision)
    const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: primary => store.get(f.base.accountId(primary)) })
    const first = await policy.resolve()
    for (const kind of ['policy', 'channel', 'model-busy', 'queue', 'network']) policy.observeFailure(kind, first)
    expect((await policy.resolve()).uid).toBe('a')
    policy.observeFailure('hard_credit', first)
    expect((await policy.current())?.uid).toBe('a')
    expect(policy.decision()).toMatchObject({ state: 'pending', servingAccount: f.a.id })
    expect((await policy.resolve()).uid).toBe('b')
    expect(policy.decision()).toMatchObject({ state: 'serving', servingAccount: f.b.id })
    expect((await f.base.current())?.uid).toBe('a')
    policy.observeFailure('hard_credit', first) // Late A response cannot rotate B.
    expect((await policy.resolve()).uid).toBe('b')
    policy.observeFailure('hard_credit', (await policy.current())!)
    await expect(policy.resolve()).rejects.toThrow('account-rotation-exhausted')
    expect(policy.decision()).toMatchObject({ state: 'exhausted', servingAccount: f.b.id })
    expect(JSON.stringify(policy.decision())).not.toMatch(/private|accessToken|refreshToken|"uid"/u)
  })
  it('serializes concurrent next requests and resets when primary consent changes', async () => {
    const f = await accounts()
    const store = new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn')
    const aid = f.a.id
    await store.update(aid, { automation: { rotate: true, members: [f.b.id], maxSwitches: 1 } }, (await store.get(aid)).revision)
    const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: primary => store.get(f.base.accountId(primary)) })
    policy.observeFailure('hard_credit', await policy.resolve())
    expect((await Promise.all([policy.resolve(), policy.resolve()])).map(value => value.uid)).toEqual(['b', 'b'])
    await store.update(aid, { automation: { rotate: false } }, (await store.get(aid)).revision)
    expect((await policy.resolve()).uid).toBe('a')
    expect(policy.decision()).toEqual({ state: 'disabled', switches: 0 })
    expect((await policy.credentialView().current())?.uid).toBe('a')
    expect((await policy.credentialView().listAccounts()).mode).toBe('saved-account')
  })
  it('does not advance a scope-frozen request through the credential view after a parallel failure', async () => {
    const f = await accounts()
    const store = new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn')
    await store.update(f.a.id, { automation: { rotate: true, members: [f.b.id] } }, (await store.get(f.a.id)).revision)
    const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: value => store.get(f.base.accountId(value)) })
    const a = await policy.beginRequest()
    policy.observeFailure('hard_credit', a)
    expect((await policy.credentialView().resolve()).uid).toBe('a')
    expect(policy.decision().state).toBe('pending')
    expect((await policy.beginRequest()).uid).toBe('b')
  })
  it('preserves uid-less default-off credential resolution without enabling automation', async () => {
    const dir = await directory()
    const desktopPath = join(dir, 'desktop.json')
    await writeFile(desktopPath, JSON.stringify({ auth: { accessToken: 'private-anonymous', refreshToken: '', expiresAt: Date.now() + 3_600_000, domain: 'www.codebuddy.cn' } }))
    const base = new WorkBuddyCredentialStore({ variant: CN_VARIANT, desktopPath, ownPath: join(dir, 'own.json'), refresh: async () => { throw new Error('must-not-refresh') } })
    const settings = new ToolkitSettingsStore(join(dir, 'settings.json'), 'cn')
    const policy = new WorkBuddyAccountPolicy({ base, region: 'cn', settings: value => settings.get(base.accountId(value)) })
    expect((await policy.resolve()).accessToken).toBe('private-anonymous')
    expect(policy.decision()).toEqual({ state: 'disabled', switches: 0 })
  })
  it('resets serving scope on a deliberate manual account change and keeps settings owned by the primary', async () => {
    const f = await accounts()
    const settings = new ToolkitSettingsStore(join(f.dir, 'settings.json'), 'cn')
    await settings.update(f.a.id, { automation: { rotate: true, members: [f.b.id] } }, (await settings.get(f.a.id)).revision)
    const owners: string[] = []
    const policy = new WorkBuddyAccountPolicy({ base: f.base, region: 'cn', settings: value => { owners.push(value.uid); return settings.get(f.base.accountId(value)) } })
    policy.observeFailure('hard_credit', await policy.resolve())
    expect((await policy.resolve()).uid).toBe('b')
    expect((await policy.current())?.uid).toBe('b')
    expect(new Set(owners)).toEqual(new Set(['a']))
    await f.base.selectAccount(f.c.id)
    expect((await policy.resolve()).uid).toBe('c')
    expect(policy.decision()).toEqual({ state: 'disabled', switches: 0 })
  })
})

describe('durable server-day check-in admission', () => {
  const id = 'cn-' + 'a'.repeat(32)
  it('admits one concurrent delivery and remembers unknown outcomes after restart', async () => {
    const path = join(await directory(), 'checkins.json')
    let now = Date.parse('2026-11-13T23:59:00Z')
    const a = new CheckinAdmissionStore(path, 'cn', { now: () => now })
    const b = new CheckinAdmissionStore(path, 'cn', { now: () => now })
    expect((await Promise.all([a.admit(id, '2026-11-13'), b.admit(id, '2026-11-13')])).sort()).toEqual([false, true])
    expect(await new CheckinAdmissionStore(path, 'cn').admit(id, '2026-11-13')).toBe(false)
    expect(await a.get(id, '2026-11-13')).toEqual({ outcome: 'unknown' })
    await a.complete(id, '2026-11-13', 'succeeded')
    expect(await b.get(id, '2026-11-13')).toEqual({ outcome: 'succeeded' })
    expect(await b.admit(id, '2026-11-14')).toBe(false)
    now += 24 * 60 * 60 * 1000
    expect(await b.admit(id, '2026-11-14')).toBe(true)
  })
  it('fails closed on invalid account/day and corrupt durable state', async () => {
    const path = join(await directory(), 'checkins.json')
    const store = new CheckinAdmissionStore(path, 'cn')
    await expect(store.admit('global-' + 'a'.repeat(32), '2026-11-13')).rejects.toThrow('checkin-input-invalid')
    await expect(store.admit(id, '2026-02-30')).rejects.toThrow('checkin-input-invalid')
    await writeFile(path, 'corrupt')
    await expect(store.admit(id, '2026-11-13')).rejects.toThrow('checkin-state-invalid')
  })
  it('shares its rolling guard with explicit manual nonces and never retries uncertain delivery', async () => {
    const path = join(await directory(), 'checkins.json')
    let now = Date.parse('2026-11-13T23:59:00Z')
    const store = new CheckinAdmissionStore(path, 'cn', { now: () => now })
    expect(await store.admitManual(id, 'explicit-action-nonce-1')).toBe(true)
    expect(await store.getManual(id, 'explicit-action-nonce-1')).toEqual({ outcome: 'unknown' })
    expect(await store.admit(id, '2026-11-14')).toBe(false)
    now -= 1000
    expect(await store.admitManual(id, 'explicit-action-nonce-2')).toBe(false)
    now += 24 * 60 * 60 * 1000 + 1000
    expect(await store.admitManual(id, 'explicit-action-nonce-1')).toBe(false)
    expect(await store.admitManual(id, 'explicit-action-nonce-2')).toBe(true)
    await store.completeManual(id, 'explicit-action-nonce-2', 'failed')
    expect(await store.admitManual(id, 'explicit-action-nonce-2')).toBe(false)
  })
})
