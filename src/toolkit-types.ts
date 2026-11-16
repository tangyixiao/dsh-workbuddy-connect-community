import type { ManualAccountStatus } from './account-store.ts'
import type { ToolkitSettings, ToolkitSettingsPatch } from './toolkit-settings.ts'
import type { UsageSummary } from './usage-store.ts'
import type { AccountCreditOverview } from './account-overview.ts'
import type { CheckinObservation } from './checkin-service.ts'

export interface ToolkitWebState {
  provider: string
  key: string
  accounts: ManualAccountStatus
  /** Opaque primary account controlling explicit feature consent. */
  account?: string
  settings?: ToolkitSettings
  capabilities: { tools: boolean; approval: boolean; context: boolean; cli: boolean; media: boolean; checkin: boolean }
  decision?: { state: string; switches: number; servingAccount?: string }
  checkin?: { state: string; credits?: number; day?: string }
  usage?: UsageSummary
  accountCredits?: Record<string, AccountCreditOverview>
  checkinResults?: Record<string, CheckinObservation>
}

export type ToolkitAction =
  | { action: 'save-account' | 'follow-desktop'; revision: string }
  | { action: 'select-account' | 'remove-account'; revision: string; id: string }
  | { action: 'rename-account'; revision: string; id: string; label: string }
  | { action: 'update-settings'; revision: string; account: string; patch: ToolkitSettingsPatch }
  | { action: 'checkin'; revision: string; id: string; account: string }
  | { action: 'refresh-account-credits'; revision: string; account: string; id?: string }

export function toolkitPath(provider: string): string {
  return `/plugins/dsh-workbuddy-connect/${provider === 'workbuddy-ai' ? 'ai/' : ''}toolkit`
}
