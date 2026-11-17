import { describe, expect, it, vi } from 'vitest'
import { WorkBuddyCheckinClient } from '../src/checkin-client.ts'
import { WorkBuddyCheckinService, type CheckinObservation, type CheckinServiceOptions } from '../src/checkin-service.ts'
import { CheckinAdmissionStore } from '../src/checkin-admission.ts'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { workbuddySavedAccountId } from '../src/account-store.ts'
import type { MediaEndpoint } from '../src/media-client.ts'

const credential = { accessToken: 'never-print', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'personal-a', source: 'desktop' as const }
describe('account-specific check-in observation', () => {
  function observed(options: Partial<CheckinServiceOptions> = {}) {
    const results: CheckinObservation[] = []
    const scope = { region: 'cn' as const, account: workbuddySavedAccountId('cn', credential), revision: 'owner-revision' }
    const client = { query: vi.fn(async () => ({ active: true, todayCheckedIn: false, serverUtcDay: '2026-11-16' })), claim: vi.fn(async () => ({ outcome: 'succeeded' as const, credit: 8 })) }
    const admission = { admit: vi.fn(async () => true), admitManual: vi.fn(async () => true), complete: vi.fn(async () => {}), completeManual: vi.fn(async () => {}) }
    const observeResult = vi.fn(async (result: CheckinObservation) => { results.push(result) })
    const current = vi.fn(async () => true)
    const service = new WorkBuddyCheckinService({ client: client as unknown as WorkBuddyCheckinClient, admission: admission as unknown as CheckinAdmissionStore, settings: async () => ({ enabled: true, members: [scope.account] }), scopes: async () => [scope], current, resolveAccess: async () => ({ credential }), observeResult, now: () => 123, ...options })
    return { service, results, client, admission, observeResult, current, scope }
  }
  it('feeds manual and automatic execution through the same safe observation seam', async () => {
    const f = observed()
    await f.service.claim(f.scope, { automatic: false, nonce: 'manual-action-nonce-1' }, new AbortController().signal)
    await f.service.tick()
    expect(f.results).toEqual([{ account: f.scope.account, time: 123, source: 'manual', outcome: 'succeeded', credit: 8 }, { account: f.scope.account, time: 123, source: 'automatic', outcome: 'succeeded', credit: 8 }])
    expect(f.observeResult).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }), f.scope, credential)
    expect(f.observeResult).toHaveBeenCalledWith(expect.objectContaining({ source: 'automatic' }), f.scope, credential)
    expect(JSON.stringify(f.results)).not.toContain('never-print')
    expect(f.admission.complete).toHaveBeenCalledTimes(1)
    expect(f.admission.completeManual).toHaveBeenCalledTimes(1)
    f.service.dispose()
  })
  it('isolates a throwing observer and never creates an additional claim or changes durable completion', async () => {
    const f = observed(); f.observeResult.mockRejectedValue(new Error('private observer path'))
    expect(await f.service.claim(f.scope, { automatic: false, nonce: 'manual-action-nonce-1' }, new AbortController().signal)).toEqual({ outcome: 'succeeded', credit: 8 })
    expect(f.client.claim).toHaveBeenCalledTimes(1)
    expect(f.observeResult).toHaveBeenCalledTimes(1)
    expect(f.admission.completeManual).toHaveBeenCalledWith(f.scope.account, 'manual-action-nonce-1', 'succeeded')
    f.service.dispose()
  })
  it('isolates failed observational capture and uses the actual post-refresh credential', async () => {
    const capture = vi.fn(async () => { throw new Error('private capture failure') })
    const f = observed({ captureObservationCredential: capture })
    expect(await f.service.claim(f.scope, { automatic: false, nonce: 'manual-action-nonce-1' }, new AbortController().signal)).toEqual({ outcome: 'succeeded', credit: 8 })
    expect(f.observeResult).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'succeeded' }), f.scope, credential)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(f.client.claim).toHaveBeenCalledTimes(1)
    expect(f.admission.completeManual).toHaveBeenCalledTimes(1)
    f.service.dispose()

    const g = observed({ captureObservationCredential: async () => ({ ...credential, accessToken: 'before-refresh-private' }) })
    await g.service.tick()
    expect(g.observeResult).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'succeeded' }), g.scope, credential)
    expect(g.client.claim).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(g.results)).not.toMatch(/before-refresh-private|never-print/u)
    g.service.dispose()
  })
  it('retains the resolver rejection when the pre-access failure observer throws', async () => {
    const f = observed({ captureObservationCredential: async () => credential, resolveAccess: async () => { throw new Error('original private resolver failure') } })
    f.observeResult.mockRejectedValue(new Error('private observation failure'))
    await expect(f.service.claim(f.scope, { automatic: true }, new AbortController().signal)).rejects.toThrow('original private resolver failure')
    expect(f.observeResult).toHaveBeenCalledWith({ account: f.scope.account, time: 123, source: 'automatic', outcome: 'failed' }, f.scope, credential)
    expect(f.client.query).not.toHaveBeenCalled()
    expect(f.client.claim).not.toHaveBeenCalled()
    expect(f.admission.admit).not.toHaveBeenCalled()
    f.service.dispose()
  })
  it('reports safe preflight failures while preserving their rejection and never retrying', async () => {
    const f = observed(); f.client.query.mockRejectedValue(new Error('private token path'))
    await expect(f.service.claim(f.scope, { automatic: false, nonce: 'manual-action-nonce-1' }, new AbortController().signal)).rejects.toThrow('private token path')
    expect(f.results).toEqual([{ account: f.scope.account, time: 123, source: 'manual', outcome: 'failed' }])
    expect(f.client.claim).not.toHaveBeenCalled()
    f.service.dispose()
  })
  it('preserves an unknown result across durable duplicate and concurrent admission', async () => {
    const f = observed(); let finish!: () => void
    f.client.claim.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve }); throw new Error('uncertain submission') })
    const first = f.service.claim(f.scope, { automatic: true }, new AbortController().signal)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(await f.service.claim(f.scope, { automatic: true }, new AbortController().signal)).toEqual({ outcome: 'already-admitted' })
    expect(f.results).toEqual([])
    finish(); expect(await first).toEqual({ outcome: 'unknown' })
    f.admission.admit.mockResolvedValue(false)
    await f.service.tick()
    expect(f.results).toEqual([{ account: f.scope.account, time: 123, source: 'automatic', outcome: 'unknown' }])
    expect(f.client.claim).toHaveBeenCalledTimes(1)
    f.service.dispose()
  })
  it('observes cancelled and removed scopes as preflight failed without submitting a claim', async () => {
    const f = observed(); f.current.mockResolvedValue(false)
    await expect(f.service.claim(f.scope, { automatic: true }, new AbortController().signal)).rejects.toMatchObject({ code: 'checkin-account-changed' })
    const controller = new AbortController(); controller.abort()
    await expect(f.service.claim(f.scope, { automatic: false, nonce: 'manual-action-nonce-1' }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.results.map(result => result.outcome)).toEqual(['failed', 'failed'])
    expect(f.client.claim).not.toHaveBeenCalled()
    f.service.dispose()
  })
})
describe('official check-in transport', () => {
  it.each(['https://www.workbuddy.cn.attacker.invalid', 'https://attacker.invalid/https://www.workbuddy.cn', 'https://www.workbuddy.ai@attacker.invalid', 'https://www.workbuddy.ai'])('rejects a foreign or deceptive check-in endpoint before sending credentials: %s', async endpoint => {
    let calls = 0
    const client = new WorkBuddyCheckinClient({ fetch: async () => { calls++; throw new Error('must not send') } })
    await expect(client.query({ credential, endpoint: endpoint as MediaEndpoint }, new AbortController().signal)).rejects.toMatchObject({ code: 'checkin-region-mismatch' })
    expect(calls).toBe(0)
  })

  it('queries the actual DesktopAccountRepo route and exposes only selected status plus HTTP UTC day', async () => {
    const requests: unknown[] = []
    const client = new WorkBuddyCheckinClient({ fetch: async (url, init) => {
      requests.push([url, init?.method, JSON.parse(String(init?.body))])
      return Response.json({ code: 0, data: { active: true, today_checked_in: false, streak_days: 2, today_credit: 8, email: 'private', freeText: 'never print' } }, { headers: { Date: 'Fri, 13 Nov 2026 14:00:00 GMT' } })
    } })
    expect(await client.query({ credential }, AbortSignal.timeout(1000))).toEqual({ active: true, todayCheckedIn: false, streakDays: 2, todayCredit: 8, serverUtcDay: '2026-11-13', daySource: 'http-date-utc-conservative' })
    expect(requests).toEqual([['https://www.workbuddy.cn/v2/billing/meter/checkin-activity-status', 'POST', {}]])
  })
  it('does no work while disabled and retains unknown claim across later ticks', async () => {
    mkdirSync(resolve('work/all-features-20261113'), { recursive: true })
    const dir = mkdtempSync(join(resolve('work/all-features-20261113'), 'checkin-test-'))
    try {
      let enabled = false
      let queries = 0
      let claims = 0
      const scope = { region: 'cn' as const, account: workbuddySavedAccountId('cn', credential), revision: 'revision-1' }
      const client = new WorkBuddyCheckinClient({ fetch: async url => {
        if (String(url).endsWith('daily-checkin')) { claims++; throw new Error('uncertain write') }
        queries++
        return Response.json({ code: 0, data: { active: true, today_checked_in: false } }, { headers: { Date: 'Fri, 13 Nov 2026 14:00:00 GMT' } })
      } })
      const service = new WorkBuddyCheckinService({ client, admission: new CheckinAdmissionStore(join(dir, 'admission.json'), 'cn'),
        settings: async () => ({ enabled, members: [scope.account] }), scopes: async () => [scope], current: async () => true, resolveAccess: async () => ({ credential }) })
      await service.tick()
      expect(queries).toBe(0)
      enabled = true
      await service.tick()
      await service.tick()
      expect(claims).toBe(1)
      service.dispose()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('requires authoritative HTTP date for automatic admission and rejects enterprise claims before transport', async () => {
    let writes = 0
    const client = new WorkBuddyCheckinClient({ fetch: async url => { if (String(url).endsWith('daily-checkin')) writes++; return Response.json({ code: 0, data: { active: true, today_checked_in: false } }) } })
    expect(await client.query({ credential }, new AbortController().signal)).not.toHaveProperty('serverUtcDay')
    await expect(client.claim({ credential: { ...credential, enterpriseId: 'enterprise' } }, new AbortController().signal)).rejects.toMatchObject({ code: 'checkin-personal-only' })
    expect(writes).toBe(0)
  })
  it('creates no timer or request from disabled configuration and disposes the enabled timer', async () => {
    vi.useFakeTimers()
    try {
      let enabled = false
      const service = new WorkBuddyCheckinService({ client: new WorkBuddyCheckinClient({ fetch: async () => { throw new Error('no request') } }), admission: {} as CheckinAdmissionStore,
        settings: async () => ({ enabled, members: [] }), scopes: async () => [], current: async () => true, resolveAccess: async () => ({ credential }) })
      await service.configure()
      expect(vi.getTimerCount()).toBe(0)
      enabled = true
      await service.configure()
      expect(vi.getTimerCount()).toBe(1)
      service.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('permits an explicit owner-guarded manual personal claim while automatic check-in and its member pool are off', async () => {
    mkdirSync(resolve('work/all-features-20261113'), { recursive: true })
    const dir = mkdtempSync(join(resolve('work/all-features-20261113'), 'checkin-test-'))
    try {
      let claims = 0
      const scope = { region: 'cn' as const, account: workbuddySavedAccountId('cn', credential), revision: 'owner-revision' }
      const client = new WorkBuddyCheckinClient({ fetch: async url => {
        if (String(url).endsWith('daily-checkin')) { claims++; return Response.json({ code: 0, data: { credit: 8 } }) }
        return Response.json({ code: 0, data: { active: true, today_checked_in: false } })
      } })
      const service = new WorkBuddyCheckinService({ client, admission: new CheckinAdmissionStore(join(dir, 'admission.json'), 'cn'), settings: async () => ({ enabled: false, members: [] }), scopes: async () => [], current: async s => s.account === scope.account && s.revision === scope.revision, resolveAccess: async () => ({ credential }) })
      expect(await service.claim(scope, { automatic: false, nonce: 'manual-action-nonce-1' }, new AbortController().signal)).toEqual({ outcome: 'succeeded', credit: 8 })
      expect(await service.claim(scope, { automatic: false, nonce: 'manual-action-nonce-2' }, new AbortController().signal)).toEqual({ outcome: 'already-admitted' })
      expect(claims).toBe(1)
      service.dispose()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
