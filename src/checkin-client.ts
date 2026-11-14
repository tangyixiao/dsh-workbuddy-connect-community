import type { WorkBuddyCredential } from './auth.ts'
import { regionOf } from './upstream.ts'
import { ToolkitToolError, toolkitThrowIfCancelled } from './host-tools.ts'
import { abortable, type MediaEndpoint } from './media-client.ts'

export interface CheckinAccess { credential: WorkBuddyCredential, endpoint?: MediaEndpoint, deviceToken?: string }
export interface CheckinStatus {
  active: boolean
  todayCheckedIn: boolean
  streakDays?: number
  todayCredit?: number
  dailyCredit?: number
  isStreakDay?: boolean
  nextStreakDay?: number
  /** Conservative HTTP server-clock boundary, never a statement about billing timezone. */
  serverUtcDay?: string
  daySource?: 'http-date-utc-conservative'
}
export interface CheckinClaim { outcome: 'succeeded' | 'failed' | 'unknown', credit?: number, streakDays?: number, isStreakDay?: boolean }

/** Exact installed DesktopAccountRepo protocol; injected fetch is the only network boundary. */
export class WorkBuddyCheckinClient {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  constructor(options: { fetch?: typeof fetch, timeoutMs?: number } = {}) {
    this.fetcher = options.fetch ?? fetch
    this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 15_000, 30_000))
  }
  async query(access: CheckinAccess, signal: AbortSignal): Promise<CheckinStatus> {
    const { data, day } = await this.post(access, '/v2/billing/meter/checkin-activity-status', signal)
    if (typeof data['active'] !== 'boolean' || typeof data['today_checked_in'] !== 'boolean') throw new ToolkitToolError('checkin-status-unavailable')
    const status: CheckinStatus = { active: data['active'], todayCheckedIn: data['today_checked_in'], ...(day === undefined ? {} : { serverUtcDay: day, daySource: 'http-date-utc-conservative' as const }) }
    for (const [wire, key] of [['streak_days', 'streakDays'], ['today_credit', 'todayCredit'], ['daily_credit', 'dailyCredit'], ['next_streak_day', 'nextStreakDay']] as const) {
      const number = data[wire]
      if (typeof number === 'number' && Number.isFinite(number) && number >= 0) status[key] = number
    }
    if (typeof data['is_streak_day'] === 'boolean') status.isStreakDay = data['is_streak_day']
    return status
  }
  async claim(access: CheckinAccess, signal: AbortSignal): Promise<CheckinClaim> {
    if (access.credential.enterpriseId) throw new ToolkitToolError('checkin-personal-only')
    const { data } = await this.post(access, '/v2/billing/meter/daily-checkin', signal)
    const credit = data['credit']
    if (typeof credit !== 'number' || !Number.isFinite(credit) || credit < 0) return { outcome: 'unknown' }
    return { outcome: 'succeeded', credit, ...(typeof data['streak_days'] === 'number' && Number.isFinite(data['streak_days']) && data['streak_days'] >= 0 ? { streakDays: data['streak_days'] } : {}), ...(typeof data['is_streak_day'] === 'boolean' ? { isStreakDay: data['is_streak_day'] } : {}) }
  }
  private async post(access: CheckinAccess, path: string, signal: AbortSignal): Promise<{ data: Record<string, unknown>, day?: string }> {
    toolkitThrowIfCancelled(signal)
    const c = access.credential
    const global = regionOf(c.domain) === 'global'
    const endpoint = access.endpoint ?? (global ? 'https://www.workbuddy.ai' : 'https://www.workbuddy.cn')
    if (global ? endpoint !== 'https://www.workbuddy.ai' : endpoint !== 'https://www.workbuddy.cn' && endpoint !== 'https://copilot.tencent.com') throw new ToolkitToolError('checkin-region-mismatch')
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
    try {
      const response = await abortable(this.fetcher(`${endpoint}${path}`, { method: 'POST', redirect: 'error', signal: requestSignal, headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${c.accessToken}`,
        ...(c.uid ? { 'X-User-Id': c.uid } : {}), ...(c.domain ? { 'X-Domain': c.domain } : {}), ...(access.deviceToken === undefined ? {} : { 'X-Device-Token': access.deviceToken }),
      }, body: '{}' }), requestSignal)
      if (!response.ok) throw new ToolkitToolError('checkin-outcome-unknown')
      const reader = response.body?.getReader()
      if (reader === undefined) throw new ToolkitToolError('checkin-outcome-unknown')
      let text = ''
      const decoder = new TextDecoder()
      try {
        for (;;) {
          requestSignal.throwIfAborted()
          const chunk = await abortable(reader.read(), requestSignal)
          if (chunk.done) break
          text += decoder.decode(chunk.value, { stream: true })
          if (text.length > 64 * 1024) throw new ToolkitToolError('checkin-outcome-unknown')
        }
        text += decoder.decode()
      } finally { void reader.cancel().catch(() => {}) }
      const envelope = JSON.parse(text) as Record<string, unknown>
      if (envelope['code'] !== 0) throw new ToolkitToolError('checkin-upstream-rejected')
      const raw = envelope['data'] ?? envelope
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ToolkitToolError('checkin-outcome-unknown')
      const date = response.headers.get('date')
      const stamp = date !== null && /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(date) ? Date.parse(date) : NaN
      return { data: raw as Record<string, unknown>, ...(Number.isFinite(stamp) ? { day: new Date(stamp).toISOString().slice(0, 10) } : {}) }
    } catch (error) {
      if (error instanceof ToolkitToolError) throw error
      throw new ToolkitToolError('checkin-outcome-unknown')
    }
  }
}
