import { describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountOverview, type AccountOverviewCapture } from '../src/account-overview.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'

const owner = 'cn-' + 'a'.repeat(32)
const ids = [owner, 'cn-' + 'b'.repeat(32), 'cn-' + 'c'.repeat(32)]
function fixture() {
  let capture: AccountOverviewCapture | undefined = { owner, revision: 'scope-1', controlRevision: 'control-1', ids }
  let now = 100
  let current = true
  const resolve = vi.fn(async (id: string) => ({ uid: id, accessToken: 'secret', refreshToken: '', expiresAtMs: 1, domain: '', source: 'dsh' as const }))
  const fetch = vi.fn(async (_credential: WorkBuddyCredential) => ({ total: 5, accounts: [] }))
  const service = new WorkBuddyAccountOverview({ capture: async () => capture, resolve, current: async (_id, _credential, expected) => current && capture?.revision === expected.revision && capture.ids.includes(_id), fetchCredits: credential => fetch(credential), now: () => now })
  return { service, resolve, fetch, set: (value: AccountOverviewCapture | undefined) => { capture = value }, time: (value: number) => { now = value }, rotate: () => { current = false } }
}
describe('saved account credit overview', () => {
  it('reads only cached state and refreshes independent credentials with globally at most two requests', async () => {
    const f = fixture()
    expect(await f.service.read()).toEqual({})
    expect(f.resolve).not.toHaveBeenCalled()
    const releases: Array<() => void> = []
    let active = 0; let peak = 0
    f.fetch.mockImplementation(async credential => {
      active++; peak = Math.max(peak, active)
      await new Promise<void>(resolve => releases.push(resolve))
      active--
      return { total: ids.indexOf(credential.uid) + 1, accounts: [] }
    })
    const first = f.service.refresh(owner, 'control-1')
    const second = f.service.refresh(owner, 'control-1', ids[0])
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.splice(0).forEach(release => release())
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.splice(0).forEach(release => release())
    await first
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.splice(0).forEach(release => release())
    await second
    expect(peak).toBe(2)
    expect(await f.service.read()).toMatchObject({ [ids[0]!]: { credits: { total: 1 }, refreshedAt: 100 }, [ids[1]!]: { credits: { total: 2 } }, [ids[2]!]: { credits: { total: 3 } } })
  })
  it('preserves the successful value and timestamp on fixed safe failure, without touching another row', async () => {
    const f = fixture()
    await f.service.refresh(owner, 'control-1')
    f.time(200); f.fetch.mockRejectedValue(new Error('private token and path'))
    await f.service.refresh(owner, 'control-1', ids[1])
    const view = await f.service.read()
    expect(view[ids[1]!]).toEqual({ credits: { total: 5, accounts: [] }, refreshedAt: 100, error: 'credits-unavailable' })
    expect(view[ids[0]!]).not.toHaveProperty('error')
    expect(JSON.stringify(view)).not.toContain('private')
    await expect(f.service.refresh(owner, 'stale')).rejects.toMatchObject({ code: 'account-selection-changed' })
    await expect(f.service.refresh(owner, 'control-1', 'missing')).rejects.toMatchObject({ code: 'account-selection-changed' })
  })
  it('preserves prior balance when upstream required numeric data is malformed', async () => {
    const f = fixture()
    await f.service.refresh(owner, 'control-1', ids[0])
    f.time(200); f.fetch.mockResolvedValue({ total: Number.NaN, accounts: [] })
    await f.service.refresh(owner, 'control-1', ids[0])
    expect((await f.service.read())[ids[0]!]).toEqual({ credits: { total: 5, accounts: [] }, refreshedAt: 100, error: 'credits-unavailable' })
  })
  it.each(['removed', 'selection', 'credential', 'signed-out'])('rejects late %s responses', async mode => {
    const f = fixture(); let finish!: () => void
    f.fetch.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve }); return { total: 99, accounts: [] } })
    const pending = f.service.refresh(owner, 'control-1', ids[1])
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (mode === 'credential') f.rotate()
    else if (mode === 'signed-out') f.set(undefined)
    else f.set({ owner, revision: 'scope-2', controlRevision: 'control-2', ids: mode === 'removed' ? [owner] : ids })
    finish(); await pending
    expect(await f.service.read()).toEqual({})
  })
})
