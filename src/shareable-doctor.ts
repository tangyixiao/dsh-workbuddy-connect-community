import { isWorkBuddySignedOutReasonCode } from './status-paths.ts'
import type { WorkBuddySignedOutReasonCode } from './status-paths.ts'
import type { DesktopAuthFormat } from './desktop-credential-protection.ts'
import type { WorkBuddyAppVersionSource } from './app-version.ts'

export interface ShareableDoctorInput {
  version: string
  runtime: string
  platform: string
  architecture: string
  provider: string
  desktopAuthFile: { present: boolean, format: DesktopAuthFormat }
  signIn: 'signed-in' | 'signed-out'
  reasonCode?: unknown
  hostHeartbeat: { present: boolean, processAlive: boolean }
  fallbackModels: number
  appVersionSource?: WorkBuddyAppVersionSource
}

export interface ShareableDoctorFailureInput {
  version: string
  runtime: string
  platform: string
  architecture: string
  provider: string
}

/** A copy-safe report built only from explicitly selected, low-risk fields. */
export function shareableDoctorReport(input: ShareableDoctorInput): Record<string, unknown> {
  const reasonCode: WorkBuddySignedOutReasonCode | undefined = isWorkBuddySignedOutReasonCode(input.reasonCode)
    ? input.reasonCode
    : undefined
  const appVersionSource = input.appVersionSource === 'installed'
    || input.appVersionSource === 'saved'
    || input.appVersionSource === 'fallback'
    ? input.appVersionSource
    : undefined
  const desktopFormat: DesktopAuthFormat = ['absent', 'plaintext', 'encrypted', 'unrecognized'].includes(input.desktopAuthFile.format)
    ? input.desktopAuthFile.format
    : 'unrecognized'
  const authReadiness = input.signIn === 'signed-in'
    ? 'credential-found'
    : reasonCode !== undefined || !input.desktopAuthFile.present ? 'needs-attention' : 'unknown'
  return {
    schemaVersion: 1,
    package: 'dsh-workbuddy-connect-community',
    version: input.version,
    runtime: input.runtime,
    platform: input.platform,
    architecture: input.architecture,
    provider: input.provider,
    desktopAuthFile: { present: input.desktopAuthFile.present, format: desktopFormat },
    signIn: input.signIn,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    hostHeartbeat: {
      present: input.hostHeartbeat.present,
      processAlive: input.hostHeartbeat.processAlive,
    },
    fallbackModels: input.fallbackModels,
    ...(appVersionSource === undefined ? {} : { appVersionSource }),
    readiness: {
      authentication: authReadiness,
      host: input.hostHeartbeat.processAlive ? 'running' : input.hostHeartbeat.present ? 'stale' : 'not-started',
      liveInference: 'not-tested',
    },
  }
}

/** Safe fallback when doctor cannot finish reading local diagnostics. */
export function shareableDoctorFailureReport(input: ShareableDoctorFailureInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    package: 'dsh-workbuddy-connect-community',
    version: input.version,
    runtime: input.runtime,
    platform: input.platform,
    architecture: input.architecture,
    provider: input.provider,
    errorCode: 'diagnostic-unavailable',
    readiness: {
      authentication: 'unknown',
      host: 'unknown',
      liveInference: 'not-tested',
    },
  }
}
