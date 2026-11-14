import { describe, expect, it, vi } from 'vitest'
import { WorkBuddyCheckinClient } from '../src/checkin-client.ts'
import { WorkBuddyCheckinService } from '../src/checkin-service.ts'
import { CheckinAdmissionStore } from '../src/checkin-admission.ts'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { workbuddySavedAccountId } from '../src/account-store.ts'
import type { MediaEndpoint } from '../src/media-client.ts'

const credential = { accessToken: 'never-print', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'personal-a', source: 'desktop' as const }
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
