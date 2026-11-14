import type { ManualAccountStatus } from './account-store.ts'
import type { ToolkitSettings, ToolkitSettingsPatch } from './toolkit-settings.ts'

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
}

export type ToolkitAction =
  | { action: 'save-account' | 'follow-desktop'; revision: string }
  | { action: 'select-account' | 'remove-account'; revision: string; id: string }
  | { action: 'rename-account'; revision: string; id: string; label: string }
  | { action: 'update-settings'; revision: string; account: string; patch: ToolkitSettingsPatch }
  | { action: 'checkin'; revision: string; id: string; account: string }

export function toolkitPath(provider: string): string {
  return `/plugins/dsh-workbuddy-connect/${provider === 'workbuddy-ai' ? 'ai/' : ''}toolkit`
}
