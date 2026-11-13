import { createHash } from 'node:crypto'
import type { WorkBuddyCredential } from './auth.ts'
import { regionOf } from './upstream.ts'

export const WORKBUDDY_ACCOUNT_SCOPE_HEADER = 'x-workbuddy-account-scope'

/** A routing guard for the loopback hop. Contains no tokens or raw identifiers. */
export function workBuddyRequestScope(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId' | 'domain'>): string {
  return createHash('sha256').update(JSON.stringify([regionOf(credential.domain), credential.uid, credential.enterpriseId ?? ''])).digest('hex')
}
