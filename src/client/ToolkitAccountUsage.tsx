import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { AccountCreditOverview } from '../account-overview.ts'
import type { CheckinObservation } from '../checkin-service.ts'
import type { UsageSummary, UsageTotals } from '../usage-store.ts'
import type { SavedAccountSummary } from '../account-store.ts'
import type { ToolkitLocaleKey } from './toolkit-locales.ts'

type Translate = (key: ToolkitLocaleKey, params?: Record<string, unknown>) => string
const small: CSSProperties = { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', overflowWrap: 'anywhere' }
const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }
export const formatNumber = (value: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
export function formatTime(value: number | undefined, t: Translate): string {
  if (value === undefined) return t('toolkitUnknownTime')
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) } catch { return t('toolkitUnknownTime') }
}
function checkinOutcome(value: CheckinObservation['outcome']): ToolkitLocaleKey {
  switch (value) {
    case 'succeeded': return 'toolkitCheckinSucceeded'
    case 'failed': return 'toolkitCheckinFailed'
    case 'already-checked-in': return 'toolkitCheckinAlready'
    case 'not-eligible': return 'toolkitCheckinIneligible'
    case 'disabled': return 'toolkitCheckinDisabled'
    case 'day-unavailable': return 'toolkitCheckinDayUnavailable'
    case 'already-admitted': return 'toolkitCheckinAdmitted'
    default: return 'toolkitCheckinUnknown'
  }
}
export function AccountObservation({ overview, checkin, name, t }: { overview: AccountCreditOverview | undefined; checkin: CheckinObservation | undefined; name: string; t: Translate }) {
  const credits = overview?.credits
  return <div style={column}>
    <p style={small}>{credits === undefined ? t('toolkitCreditsUnknown') : credits.unlimited ? t('toolkitCreditsUnlimited') : t('toolkitCreditsTotal', { credits: formatNumber(credits.total) })}</p>
    <p style={small}>{credits?.expiry === undefined ? t('toolkitCreditExpiryUnknown') : `${t('toolkitCredits24h', { credits: formatNumber(credits.expiry.within24h.total) })} · ${t('toolkitCredits7d', { credits: formatNumber(credits.expiry.within7d.total) })}`}</p>
    <p style={small}>{t('toolkitCreditsRefreshed', { time: formatTime(overview?.refreshedAt, t) })}{overview?.error ? ` · ${t('toolkitCreditsError')}` : ''}</p>
    {checkin === undefined ? null : <p style={small} role="status">{name} · {t(checkin.source === 'automatic' ? 'toolkitCheckinAutomatic' : 'toolkitCheckinManual')} · {formatTime(checkin.time, t)} · {t(checkinOutcome(checkin.outcome))}{checkin.credit === undefined ? '' : ` · ${t('toolkitCheckinCredits', { credits: formatNumber(checkin.credit) })}`}</p>}
  </div>
}
export function ToolkitUsage({ usage, accounts, owner, t }: { usage: UsageSummary | undefined; accounts: SavedAccountSummary[]; owner: string | undefined; t: Translate }) {
  const [period, setPeriod] = useState<'1' | '7' | '30'>('1')
  const accountName = (id: string): string => {
    const index = accounts.findIndex(account => account.id === id)
    return index >= 0 ? accounts[index]!.label?.trim() || t('toolkitAccountName', { number: index + 1 }) : id === owner ? t('toolkitPrimaryAccount') : t('toolkitUnknownAccount')
  }
  const summary = (totals: UsageTotals): string => t('toolkitUsageTotals', { requests: formatNumber(totals.requests), credits: formatNumber(totals.observedCredits), unknown: formatNumber(totals.unknownCreditRequests) })
  return <div style={column}>
    <p style={small}>{t('toolkitUsageCoverage')}</p>
    {usage === undefined ? <p style={small}>{t('toolkitUsageUnavailable')}</p> : <>
      <label style={{ ...small, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>{t('toolkitUsagePeriod')}<select aria-label={t('toolkitUsagePeriod')} value={period} style={{ font: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: 6 }} onChange={event => { if (['1', '7', '30'].includes(event.currentTarget.value)) setPeriod(event.currentTarget.value as '1' | '7' | '30') }}>{(['1', '7', '30'] as const).map(days => <option key={days} value={days}>{t('toolkitUsageDays', { days })}</option>)}</select></label>
      <p style={small}>{summary(usage.windows[period])}</p>
      <p style={small}>{t('toolkitUsageLimits', { days: usage.coverage.retentionDays, records: formatNumber(usage.coverage.maxRecords), mib: formatNumber(usage.coverage.maxBytes / 1024 / 1024) })}</p>
      <p style={small}>{t('toolkitUsageRange', { from: formatTime(usage.coverage.from ?? undefined, t), to: formatTime(usage.coverage.to, t) })}</p>
      {usage.coverage.truncated ? <p style={small} role="status">{t('toolkitUsageTruncated')}</p> : null}
      {usage.status !== 'available' || usage.persistence !== 'persisted' ? <p style={small} role="status">{t(usage.status === 'history-invalid' ? 'toolkitUsageInvalid' : usage.status === 'storage-unavailable' || usage.persistence === 'unavailable' ? 'toolkitUsageStorageError' : 'toolkitUsagePending')}</p> : null}
      <span style={small}>{t('toolkitUsageAccounts')}</span>
      {usage.byAccount.length === 0 ? <p style={small}>{t('toolkitUsageEmpty')}</p> : usage.byAccount.map(row => <p key={row.account} style={small}>{accountName(row.account)} · {summary(row.windows[period])}</p>)}
      <details><summary style={{ ...small, cursor: 'pointer' }}>{t('toolkitUsageModels', { count: usage.byModel.length })}</summary><div style={{ ...column, maxHeight: 240, overflowY: 'auto', marginTop: 8 }}>{usage.byModel.map(row => <p key={row.model} style={small}>{row.model} · {summary(row.windows[period])}</p>)}</div></details>
      <details><summary style={{ ...small, cursor: 'pointer' }}>{t('toolkitUsageRecent', { count: usage.recent.length })}</summary><div style={{ ...column, maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>{usage.recent.map(row => <p key={`${row.account}:${row.responseId}`} style={small}>{accountName(row.account)} · {row.model} · {formatTime(row.completedAt, t)} · {row.credit === undefined ? t('toolkitCreditsUnknown') : t('toolkitObservedCredits', { credits: formatNumber(row.credit) })}<br />{t('toolkitUsageResponse', { id: row.responseId })}</p>)}</div></details>
    </>}
  </div>
}
