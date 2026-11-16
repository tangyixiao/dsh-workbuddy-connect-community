import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyAccountStore } from '../src/account-store.ts'
import { WorkBuddyToolkitRuntime } from '../src/toolkit-runtime.ts'
import { CN_VARIANT, AI_VARIANT, type WorkBuddyVariant } from '../src/variants.ts'
import { ToolkitSettingsStore } from '../src/toolkit-settings.ts'
import type { WorkBuddyUpstreamClient } from '../src/upstream.ts'

const owned: string[] = []
const runtimes: WorkBuddyToolkitRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks()
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture(variant: WorkBuddyVariant = CN_VARIANT, options: { fetch?: typeof fetch } = {}) {
  const parent = join(process.cwd(), 'work', 'all-features-20261113', 'runtime-tests')
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'fixture-')); owned.push(dir)
  vi.stubEnv('DSH_HOME', dir)
  const calls: string[] = []
  vi.stubGlobal('fetch', options.fetch ?? (async (url: unknown) => { calls.push(String(url)); throw new Error('unexpected fixture upstream call') }))
  const desktopPath = join(dir, 'desktop.json')
  const ownPath = join(dir, 'own.json')
  const writeDesktop = (uid: string) => writeFile(desktopPath, JSON.stringify({ auth: { accessToken: `private-token-${uid}`, refreshToken: `private-refresh-${uid}`, expiresAt: Date.now() + 3_600_000, domain: variant.region === 'cn' ? 'www.codebuddy.cn' : 'www.workbuddy.ai' }, account: { uid } }))
  await writeDesktop('owner-a')
  const base = new WorkBuddyCredentialStore({ variant, desktopPath, ownPath, refresh: async () => { throw new Error('unexpected fixture refresh') } })
  const a = await base.saveCurrentAccount()
  await writeDesktop('member-b')
  const b = await base.saveCurrentAccount()
  await base.selectAccount(a.id)
  const client = { fetchMediaModels: async () => { calls.push('media-models'); return [] }, fetchCredits: vi.fn(async () => ({ total: 7, accounts: [] })) } as unknown as WorkBuddyUpstreamClient
  const runtime = new WorkBuddyToolkitRuntime(base, variant, client); runtimes.push(runtime)
  return { dir, base, runtime, a, b, calls, client, writeDesktop, statePath: join(dir, `${variant.visibilityFilename}.toolkit`) }
}

describe('toolkit runtime account and consent integration', () => {
  it('fetches saved credits only from explicit guarded actions without selecting, and rejects removed late rows', async () => {
    const f = await fixture()
    const before = await f.runtime.state('key')
    expect(before.accountCredits).toEqual({})
    expect(f.client.fetchCredits).not.toHaveBeenCalled()
    await f.runtime.action({ action: 'refresh-account-credits', account: f.a.id, revision: before.accounts.revision, id: f.b.id })
    expect(f.client.fetchCredits).toHaveBeenCalledWith(expect.objectContaining({ uid: 'member-b' }))
    expect((await f.base.current())?.uid).toBe('owner-a')
    expect((await f.runtime.state('key')).accountCredits?.[f.b.id]).toMatchObject({ credits: { total: 7 } })
    expect(f.client.fetchCredits).toHaveBeenCalledTimes(1)
    await expect(f.runtime.action({ action: 'refresh-account-credits', account: f.b.id, revision: before.accounts.revision })).rejects.toMatchObject({ code: 'account-selection-changed' })
    let finish!: () => void
    vi.mocked(f.client.fetchCredits).mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve }); return { total: 99, accounts: [] } })
    const pending = f.runtime.action({ action: 'refresh-account-credits', account: f.a.id, revision: before.accounts.revision, id: f.b.id })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await f.base.removeAccount(f.b.id)
    finish(); await pending
    expect((await f.runtime.state('key')).accountCredits).toEqual({})
    expect(f.calls).toEqual([])
  })
  it.each([CN_VARIANT, AI_VARIANT])('projects local usage only for current/saved accounts in $id without fetching credits', async variant => {
    const f = await fixture(variant)
    const common = { model: 'hy3', completedAt: Date.now(), credit: 2 }
    await f.runtime.usage.record({ ...common, account: f.a.id, responseId: 'owner-response' })
    await f.runtime.usage.record({ ...common, account: f.b.id, responseId: 'saved-response' })
    await f.runtime.usage.record({ ...common, account: `${variant.region}-${'f'.repeat(32)}`, responseId: 'other-private-response' })
    const state = await f.runtime.state('key')
    expect(state.usage?.windows['1'].requests).toBe(2)
    expect(state.usage?.recent.map(row => row.account).sort()).toEqual([f.a.id, f.b.id].sort())
    expect(JSON.stringify(state)).not.toMatch(/other-private-response|private-token|private-refresh|owner-a|member-b/u)
    await f.base.removeAccount(f.b.id)
    expect((await f.runtime.state('key')).usage?.recent.map(row => row.account)).toEqual([f.a.id])
    await f.base.followDesktop()
    await rm(join(f.dir, 'desktop.json'))
    await rm(join(f.dir, 'own.json'), { force: true })
    expect((await f.runtime.state('key')).usage).toBeUndefined()
    expect(f.calls).toEqual([])
  })
  it('rejects the entire stale private projection after the authorized account snapshot changes during a usage read', async () => {
    const f = await fixture()
    await f.runtime.usage.record({ account: f.b.id, model: 'hy3', responseId: 'removed-account', completedAt: Date.now() })
    const read = f.runtime.usage.read.bind(f.runtime.usage)
    vi.spyOn(f.runtime.usage, 'read').mockImplementationOnce(async accounts => {
      const result = await read(accounts)
      await f.base.removeAccount(f.b.id)
      return result
    })
    await expect(f.runtime.state('key')).rejects.toMatchObject({ code: 'account-selection-changed' })
    expect(f.calls).toEqual([])
  })
  it.each([CN_VARIANT, AI_VARIANT])('stays default-off without requests or scheduler timers for $id', async variant => {
    const f = await fixture(variant)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await f.runtime.refresh()
    const state = await f.runtime.state('owner-control-key')
    expect(state.settings?.features).toEqual({ images: false, videos: false, cli: false, contextRescue: false })
    expect(f.runtime.definitions()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await f.runtime.checkin.tick()
    expect(f.calls).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    expect(JSON.stringify(state)).not.toMatch(/private-token|private-refresh|owner-a|member-b/u)
  })
  it('keeps primary consent owned by the manually selected account while policy serves a member', async () => {
    const f = await fixture()
    await f.runtime.settings.update(f.a.id, { automation: { rotate: true, members: [f.b.id], maxSwitches: 1 } }, 'initial')
    await f.runtime.refresh()
    f.runtime.policy.observeFailure('hard_credit', await f.runtime.policy.beginRequest())
    expect((await f.runtime.policy.beginRequest()).uid).toBe('member-b')
    expect((await f.runtime.primary())?.account).toBe(f.a.id)
    expect((await f.runtime.scope())?.account).toBe(f.b.id)
    expect((await f.runtime.state('key')).account).toBe(f.a.id)
    expect((await f.base.current())?.uid).toBe('owner-a')
    expect(f.calls).toEqual([])
  })
  it('rejects stale manual controls and a settings request for a different primary account', async () => {
    const f = await fixture()
    const original = await f.runtime.state('key')
    await f.base.selectAccount(f.b.id)
    await expect(f.runtime.action({ action: 'follow-desktop', revision: original.accounts.revision })).rejects.toThrow('account-selection-changed')
    await expect(f.runtime.action({ action: 'update-settings', revision: original.settings!.revision, account: f.a.id, patch: { automation: { rotate: true } } })).rejects.toMatchObject({ code: 'account-selection-changed' })
    expect((await f.runtime.settings.get(f.a.id)).automation.rotate).toBe(false)
    expect(f.calls).toEqual([])
  })
  it('refreshes the settings owner when follow-desktop changes identity without changing selection revision', async () => {
    const f = await fixture()
    await f.writeDesktop('owner-a'); await f.base.followDesktop()
    await f.runtime.settings.update(f.a.id, { features: { images: true } }, 'initial')
    const before = await f.runtime.state('key')
    expect(before.account).toBe(f.a.id)
    expect(before.settings?.features.images).toBe(true)
    await f.writeDesktop('member-b')
    const after = await f.runtime.state('key')
    expect(after.accounts.revision).toBe(before.accounts.revision)
    expect(after.account).toBe(f.b.id)
    expect(after.settings?.features.images).toBe(false)
    await expect(f.runtime.action({ action: 'checkin', account: f.a.id, id: f.a.id, revision: before.accounts.revision })).rejects.toMatchObject({ code: 'account-selection-changed' })
    expect(f.calls).toEqual([])
  })
  it('requires the host capability and approval seams before enabling paid features', async () => {
    const f = await fixture()
    for (const features of [{ images: true }, { videos: true }, { cli: true }]) {
      await expect(f.runtime.action({ action: 'update-settings', account: f.a.id, revision: 'initial', patch: { features } })).rejects.toMatchObject({ code: 'toolkit-host-unavailable' })
    }
    await expect(f.runtime.action({ action: 'update-settings', account: f.a.id, revision: 'initial', patch: { features: { contextRescue: true } } })).rejects.toMatchObject({ code: 'rescue-host-unavailable' })
    f.runtime.attach({ tools: true, approval: true, context: false }, { request: async () => 'allowed-once' })
    await f.runtime.action({ action: 'update-settings', account: f.a.id, revision: 'initial', patch: { features: { images: true } } })
    expect(f.runtime.definitions().map(tool => tool.name)).toEqual(['workbuddy_cn_image', 'workbuddy_cn_media_task'])
    const oldTool = f.runtime.definitions()[0]!
    await f.runtime.action({ action: 'update-settings', account: f.a.id, revision: (await f.runtime.settings.get(f.a.id)).revision, patch: { features: { images: false } } })
    await expect(oldTool.execute({ mode: 'text', prompt: 'Synthetic example' }, { agent: {}, callId: 'fixture-call', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'media-disabled' })
    expect(f.runtime.definitions()).toEqual([])
    expect(f.calls).toEqual([])
  })
  it('rejects unknown saved members and more than the scheduler-supported sixteen entries', async () => {
    const f = await fixture()
    await expect(f.runtime.action({ action: 'update-settings', account: f.a.id, revision: 'initial', patch: { automation: { members: ['cn-' + 'f'.repeat(32)] } } })).rejects.toMatchObject({ code: 'account-not-found' })
    const settings = new ToolkitSettingsStore(join(f.dir, 'limits.json'), 'cn')
    await expect(settings.update(f.a.id, { automation: { members: Array.from({ length: 17 }, (_, index) => `cn-${index.toString(16).padStart(32, '0')}`) } }, 'initial')).rejects.toThrow('toolkit-settings-invalid')
  })
  it('does not restart an enabled check-in timer on repeated UI state reads', async () => {
    const urls: string[] = []
    const f = await fixture(undefined, { fetch: async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ code: 0, data: { active: true, today_checked_in: true } }), { headers: { date: 'Fri, 13 Nov 2026 08:00:00 GMT' } })
    } })
    await f.runtime.settings.update(f.a.id, { automation: { checkin: true, members: [f.a.id] } }, 'initial')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await f.runtime.refresh()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    await f.runtime.state('key')
    await f.runtime.state('key')
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(urls.length).toBe(1))
    expect(urls[0]).toContain('checkin-activity-status')
    expect(urls.some(url => url.includes('daily-checkin'))).toBe(false)
    f.runtime.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('serializes an explicit consent commit and a simultaneous manual switch without enabling the new owner', async () => {
    const f = await fixture()
    f.runtime.attach({ tools: true, approval: true, context: false }, { request: async () => 'allowed-once' })
    let unlock!: () => void
    let locked!: () => void
    const ready = new Promise<void>(resolve => { locked = resolve })
    const lock = withFileLock(f.statePath, async () => { locked(); await new Promise<void>(resolve => { unlock = resolve }) })
    await ready
    const pending = f.runtime.action({ action: 'update-settings', account: f.a.id, revision: 'initial', patch: { features: { images: true } } }).then(value => value, error => error)
    // Actual local reads complete while the settings commit waits for this durable lock.
    await new Promise(resolve => setTimeout(resolve, 100))
    const selecting = f.base.selectAccount(f.b.id)
    unlock(); await lock
    expect(await pending).toEqual({ state: 'updated' })
    await selecting
    expect((await f.runtime.settings.get(f.a.id)).features.images).toBe(true)
    expect((await f.runtime.settings.get(f.b.id)).features.images).toBe(false)
    expect((await f.base.current())?.uid).toBe('member-b')
    expect(f.calls).toEqual([])
  })
  it('persists owner controls and cancels automatic work on explicit disable', async () => {
    const f = await fixture()
    await f.runtime.action({ action: 'rename-account', id: f.b.id, label: '备用账号', revision: (await f.base.listAccounts()).revision })
    expect((await f.base.listAccounts()).accounts.find(account => account.id === f.b.id)?.label).toBe('备用账号')
    await f.runtime.settings.update(f.a.id, { automation: { checkin: true, members: [f.a.id] } }, 'initial')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await f.runtime.refresh()
    expect(vi.getTimerCount()).toBe(1)
    const config = await f.runtime.settings.get(f.a.id)
    await f.runtime.action({ action: 'update-settings', account: f.a.id, revision: config.revision, patch: { automation: { checkin: false } } })
    expect(vi.getTimerCount()).toBe(0)
    expect(JSON.parse(await readFile(f.statePath, 'utf8')).accounts[f.a.id].automation.checkin).toBe(false)
    expect(f.calls).toEqual([])
  })
  it('does not display another primary account’s manual check-in result after switching owners', async () => {
    const requests: string[] = []
    const f = await fixture(undefined, { fetch: async (url: string | URL | Request) => {
      const path = String(url); requests.push(path)
      return new Response(JSON.stringify({ code: 0, data: path.includes('daily-checkin') ? { credit: 5 } : { active: true, today_checked_in: false } }), { headers: { date: 'Fri, 13 Nov 2026 08:00:00 GMT' } })
    } })
    await f.runtime.action({ action: 'checkin', id: f.a.id, account: f.a.id, revision: (await f.base.listAccounts()).revision })
    expect((await f.runtime.settings.get(f.a.id)).automation).toMatchObject({ checkin: false, members: [] })
    expect((await f.runtime.state('key')).checkin).toEqual({ state: 'succeeded', credits: 5 })
    expect((await f.runtime.state('key')).checkinResults?.[f.a.id]).toMatchObject({ account: f.a.id, source: 'manual', outcome: 'succeeded', credit: 5 })
    expect(requests).toHaveLength(2)
    await f.base.selectAccount(f.b.id)
    expect((await f.runtime.state('key')).checkin).toBeUndefined()
    expect((await f.runtime.state('key')).checkinResults).toEqual({})
    expect(requests).toHaveLength(2)
  })
  it('keeps automatic unknown per account across duplicate admission and prunes removed accounts', async () => {
    let claims = 0
    const f = await fixture(undefined, { fetch: async url => {
      if (String(url).includes('daily-checkin')) { claims++; throw new Error('private uncertain submission') }
      return Response.json({ code: 0, data: { active: true, today_checked_in: false } }, { headers: { date: 'Mon, 16 Nov 2026 12:00:00 GMT' } })
    } })
    await f.runtime.settings.update(f.a.id, { automation: { checkin: true, members: [f.b.id] } }, 'initial')
    await f.runtime.checkin.tick()
    const first = (await f.runtime.state('key')).checkinResults?.[f.b.id]
    expect(first).toMatchObject({ account: f.b.id, source: 'automatic', outcome: 'unknown' })
    await f.runtime.checkin.tick()
    expect((await f.runtime.state('key')).checkinResults?.[f.b.id]).toEqual(first)
    expect(claims).toBe(1)
    await f.base.removeAccount(f.b.id)
    expect((await f.runtime.state('key')).checkinResults).toEqual({})
  })
  it.each(['removed', 'selection'])('drops a late check-in result after %s scope change', async mode => {
    let finish!: () => void
    const f = await fixture(undefined, { fetch: async url => {
      if (String(url).includes('daily-checkin')) { await new Promise<void>(resolve => { finish = resolve }); return Response.json({ code: 0, data: { credit: 9 } }) }
      return Response.json({ code: 0, data: { active: true, today_checked_in: false } })
    } })
    const pending = f.runtime.action({ action: 'checkin', id: f.b.id, account: f.a.id, revision: (await f.base.listAccounts()).revision })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (mode === 'removed') await f.base.removeAccount(f.b.id)
    else await f.base.selectAccount(f.b.id)
    finish(); await pending
    const state = await f.runtime.state('key')
    expect(state.checkinResults).toEqual({})
    expect(state.checkin).toBeUndefined()
  })
  it('drops an old member check-in observation after credential-only rotation without selection/control changes', async () => {
    let finish!: () => void
    const f = await fixture(undefined, { fetch: async url => {
      if (String(url).includes('daily-checkin')) { await new Promise<void>(resolve => { finish = resolve }); return Response.json({ code: 0, data: { credit: 9 } }) }
      return Response.json({ code: 0, data: { active: true, today_checked_in: false } })
    } })
    const before = await f.runtime.primary()
    const writer = new WorkBuddyAccountStore(`${f.base.ownAuthPath()}.accounts.json`, 'cn')
    const target = await writer.saved(f.b.id, before!.snapshot)
    const pending = f.runtime.action({ action: 'checkin', id: f.b.id, account: f.a.id, revision: before!.snapshot.controlRevision })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await writer.commitSavedRefresh(target, { ...target.credential, accessToken: 'rotated-private-token', refreshToken: 'rotated-private-refresh' })
    const afterRotation = await f.runtime.primary()
    expect(afterRotation?.revision).toBe(before?.revision)
    expect(afterRotation?.snapshot.controlRevision).toBe(before?.snapshot.controlRevision)
    finish(); await pending
    const state = await f.runtime.state('key')
    expect(state.checkinResults).toEqual({})
    expect(state.checkin).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('rotated-private')
  })
  it('checks the target credential after the observer final owner reread yields to a member-only rotation', async () => {
    let finish!: () => void
    const f = await fixture(undefined, { fetch: async url => {
      if (String(url).includes('daily-checkin')) { await new Promise<void>(resolve => { finish = resolve }); return Response.json({ code: 0, data: { credit: 9 } }) }
      return Response.json({ code: 0, data: { active: true, today_checked_in: false } })
    } })
    const primary = f.runtime.primary.bind(f.runtime)
    const before = await primary()
    const writer = new WorkBuddyAccountStore(`${f.base.ownAuthPath()}.accounts.json`, 'cn')
    const target = await writer.saved(f.b.id, before!.snapshot)
    const pending = f.runtime.action({ action: 'checkin', id: f.b.id, account: f.a.id, revision: before!.snapshot.controlRevision })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    let observerOwnerReads = 0; let rotated = false
    vi.spyOn(f.runtime, 'primary').mockImplementation(async () => {
      const owner = await primary()
      // Once submission is held, the next two owner reads belong to result observation.
      if (++observerOwnerReads === 2) {
        await writer.commitSavedRefresh(target, { ...target.credential, accessToken: 'final-read-private-token' })
        rotated = true
      }
      return owner
    })
    finish(); await pending
    expect(rotated).toBe(true)
    expect((await primary())?.revision).toBe(before?.revision)
    const state = await f.runtime.state('key')
    expect(state.checkinResults).toEqual({})
    expect(state.checkin).toBeUndefined()
  })
})
