/** Explicit plugin-owned account snapshots. Never reads or writes desktop state. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { WorkBuddyCredential } from './auth.ts'
import { regionOf, type WorkBuddyRegion } from './upstream.ts'

const MAX_BYTES = 1_048_576
const MAX_ACCOUNTS = 100
type AccountErrorCode = 'account-state-invalid' | 'account-not-found' | 'account-identity-missing' | 'account-region-mismatch' | 'account-selection-changed' | 'account-limit-reached' | 'account-storage-unavailable' | 'account-selected' | 'account-label-invalid'

/** Fixed diagnostic codes prevent filesystem/upstream messages exposing credentials. */
export class WorkBuddyAccountError extends Error {
  constructor(readonly code: AccountErrorCode) { super(`workbuddy: ${code}`) }
}

export interface SavedAccountSummary {
  id: string
  region: WorkBuddyRegion
  selected: boolean
  expiresAtMs: number
  label?: string
}
export interface ManualAccountStatus {
  revision: string
  mode: 'follow-desktop' | 'saved-account'
  accounts: SavedAccountSummary[]
}
export interface AccountSelection {
  revision: string
  selectedId: string | null
}
/** Internal capture only; the hash never appears in account-status output. */
export interface AccountSnapshot extends AccountSelection {
  accountsRevision: string
  controlRevision: string
  credentialRevision?: string
}
export interface SavedAccountCapture extends AccountSnapshot { id: string; credential: WorkBuddyCredential; credentialRevision: string }
interface SavedAccount { id: string; credential: WorkBuddyCredential; label?: string }
interface AccountDocument extends AccountSelection {
  version: 1
  region: WorkBuddyRegion
  accounts: SavedAccount[]
  controlRevision?: string
}

function identity(region: WorkBuddyRegion, credential: WorkBuddyCredential): string {
  if (credential.uid.trim() === '') throw new WorkBuddyAccountError('account-identity-missing')
  return `${region}-${createHash('sha256').update(JSON.stringify([region, credential.uid, credential.enterpriseId ?? ''])).digest('hex').slice(0, 32)}`
}
/** Stable opaque identity, safe for owner controls and settings keys. */
export function workbuddySavedAccountId(region: WorkBuddyRegion, credential: WorkBuddyCredential): string { return identity(region, credential) }
function credentialRevision(credential: WorkBuddyCredential): string { return createHash('sha256').update(JSON.stringify(credential)).digest('hex') }
function validLabel(label: unknown): label is string { return typeof label === 'string' && label.trim().length > 0 && label.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(label) }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}
function validCredential(value: unknown): value is WorkBuddyCredential {
  return record(value)
    && boundedString(value['accessToken'], 65_536) && value['accessToken'] !== ''
    && boundedString(value['refreshToken'], 65_536)
    && boundedString(value['uid'], 512) && value['uid'].trim() !== ''
    && boundedString(value['domain'], 512)
    && typeof value['expiresAtMs'] === 'number' && Number.isFinite(value['expiresAtMs']) && value['expiresAtMs'] >= 0
    && (value['refreshExpiresAtMs'] === undefined || (typeof value['refreshExpiresAtMs'] === 'number' && Number.isFinite(value['refreshExpiresAtMs']) && value['refreshExpiresAtMs'] >= 0))
    && (value['enterpriseId'] === undefined || boundedString(value['enterpriseId'], 512))
    && (value['nickname'] === undefined || boundedString(value['nickname'], 512))
    && (value['source'] === 'desktop' || value['source'] === 'dsh')
}

export class WorkBuddyAccountStore {
  constructor(private readonly path: string, private readonly region: WorkBuddyRegion) {}

  private empty(): AccountDocument {
    return { version: 1, region: this.region, revision: 'desktop', selectedId: null, accounts: [] }
  }

  /** Capped read; corrupt documents always fail closed, including a lost selection. */
  private async read(): Promise<AccountDocument> {
    try {
      const handle = await open(this.path, 'r')
      let text: string
      try {
        const size = (await handle.stat()).size
        if (size > MAX_BYTES) throw new WorkBuddyAccountError('account-state-invalid')
        const bytes = Buffer.alloc(size + 1)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > size) throw new WorkBuddyAccountError('account-state-invalid')
        text = bytes.subarray(0, bytesRead).toString('utf8')
      } finally { await handle.close() }
      const value: unknown = JSON.parse(text)
      if (!record(value) || value['version'] !== 1 || value['region'] !== this.region
        || !boundedString(value['revision'], 64) || value['revision'] === ''
        || (value['controlRevision'] !== undefined && (!boundedString(value['controlRevision'], 64) || value['controlRevision'] === ''))
        || !(value['selectedId'] === null || boundedString(value['selectedId'], 48))
        || !Array.isArray(value['accounts']) || value['accounts'].length > MAX_ACCOUNTS) throw new WorkBuddyAccountError('account-state-invalid')
      const ids = new Set<string>()
      for (const account of value['accounts']) {
        if (!record(account) || !validCredential(account['credential']) || regionOf(account['credential'].domain) !== this.region
          || account['id'] !== identity(this.region, account['credential']) || ids.has(account['id'] as string)
          || (account['label'] !== undefined && !validLabel(account['label']))) throw new WorkBuddyAccountError('account-state-invalid')
        ids.add(account['id'] as string)
      }
      if (value['selectedId'] !== null && !ids.has(value['selectedId'] as string)) throw new WorkBuddyAccountError('account-state-invalid')
      return value as unknown as AccountDocument
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return this.empty()
      throw error instanceof WorkBuddyAccountError ? error : new WorkBuddyAccountError('account-state-invalid')
    }
  }

  private async locked<T>(operation: (document: AccountDocument) => Promise<T>): Promise<T> {
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      return await withFileLock(this.path, async () => operation(await this.read()))
    } catch (error) {
      throw error instanceof WorkBuddyAccountError ? error : new WorkBuddyAccountError('account-storage-unavailable')
    }
  }

  private async write(document: AccountDocument): Promise<void> {
    const text = `${JSON.stringify(document)}\n`
    if (Buffer.byteLength(text) > MAX_BYTES) throw new WorkBuddyAccountError('account-limit-reached')
    await writeFileAtomic(this.path, text, { mode: 0o600, dirMode: 0o700 })
  }

  private accountsRevision(document: AccountDocument): string {
    return createHash('sha256').update(JSON.stringify(document.accounts)).digest('hex')
  }
  private controlRevision(document: AccountDocument): string { return document.controlRevision ?? document.revision }
  private checkControl(document: AccountDocument, expectedRevision?: string): void {
    if (expectedRevision !== undefined && expectedRevision !== this.controlRevision(document)) throw new WorkBuddyAccountError('account-selection-changed')
  }
  private checkSnapshot(document: AccountDocument, captured: AccountSnapshot): void {
    if (captured.revision !== document.revision || captured.selectedId !== document.selectedId || captured.controlRevision !== this.controlRevision(document)) throw new WorkBuddyAccountError('account-selection-changed')
  }

  async selection(): Promise<AccountSnapshot & { credential?: WorkBuddyCredential }> {
    const document = await this.read()
    const credential = document.accounts.find(account => account.id === document.selectedId)?.credential
    return { revision: document.revision, selectedId: document.selectedId, controlRevision: this.controlRevision(document), accountsRevision: this.accountsRevision(document), ...credential === undefined ? {} : { credentialRevision: credentialRevision(credential), credential: { ...credential, source: 'dsh' as const } } }
  }

  async list(): Promise<ManualAccountStatus> {
    const document = await this.read()
    return { revision: this.controlRevision(document), mode: document.selectedId === null ? 'follow-desktop' : 'saved-account', accounts: document.accounts.map(account => this.summary(account, document)) }
  }

  private summary(account: SavedAccount, document: AccountDocument): SavedAccountSummary {
    return { id: account.id, region: this.region, selected: account.id === document.selectedId, expiresAtMs: account.credential.expiresAtMs, ...account.label === undefined ? {} : { label: account.label } }
  }

  async save(credential: WorkBuddyCredential, captured?: AccountSnapshot, expectedRevision?: string): Promise<SavedAccountSummary> {
    if (regionOf(credential.domain) !== this.region) throw new WorkBuddyAccountError('account-region-mismatch')
    const id = identity(this.region, credential)
    if (!validCredential(credential)) throw new WorkBuddyAccountError('account-state-invalid')
    return await this.locked(async document => {
      this.checkControl(document, expectedRevision)
      if (captured !== undefined && (captured.revision !== document.revision || captured.selectedId !== document.selectedId)) {
        throw new WorkBuddyAccountError('account-selection-changed')
      }
      const existing = document.accounts.find(account => account.id === id)
      // A save reads credentials before obtaining this lock. Preserve a snapshot
      // changed since that capture (including refresh-token rotation at equal
      // expiry), and never replace an already fresher snapshot with desktop data.
      if (existing !== undefined && ((captured !== undefined && captured.accountsRevision !== this.accountsRevision(document))
        || existing.credential.expiresAtMs > credential.expiresAtMs)) return this.summary(existing, document)
      if (!existing && document.accounts.length >= MAX_ACCOUNTS) throw new WorkBuddyAccountError('account-limit-reached')
      const account: SavedAccount = { id, credential: { ...credential }, ...existing?.label === undefined ? {} : { label: existing.label } }
      if (existing) document.accounts[document.accounts.indexOf(existing)] = account
      else document.accounts.push(account)
      document.controlRevision = randomUUID()
      await this.write(document)
      return this.summary(account, document)
    })
  }

  async select(id: string | null, expectedRevision?: string): Promise<void> {
    await this.locked(async document => {
      this.checkControl(document, expectedRevision)
      if (id !== null && !document.accounts.some(account => account.id === id)) throw new WorkBuddyAccountError('account-not-found')
      document.selectedId = id
      document.revision = randomUUID()
      document.controlRevision = randomUUID()
      await this.write(document)
    })
  }

  async rename(id: string, label: string, expectedRevision?: string): Promise<void> {
    if (!validLabel(label)) throw new WorkBuddyAccountError('account-label-invalid')
    await this.locked(async document => {
      this.checkControl(document, expectedRevision)
      const account = document.accounts.find(value => value.id === id)
      if (account === undefined) throw new WorkBuddyAccountError('account-not-found')
      account.label = label.trim()
      document.controlRevision = randomUUID()
      await this.write(document)
    })
  }

  async remove(id: string, expectedRevision?: string): Promise<void> {
    await this.locked(async document => {
      this.checkControl(document, expectedRevision)
      if (document.selectedId === id) throw new WorkBuddyAccountError('account-selected')
      const index = document.accounts.findIndex(value => value.id === id)
      if (index < 0) throw new WorkBuddyAccountError('account-not-found')
      document.accounts.splice(index, 1)
      document.controlRevision = randomUUID()
      await this.write(document)
    })
  }

  /** Capture a saved member without mutating the manually selected account. */
  async saved(id: string, captured: AccountSnapshot): Promise<SavedAccountCapture> {
    const document = await this.read()
    this.checkSnapshot(document, captured)
    const account = document.accounts.find(value => value.id === id)
    if (account === undefined) throw new WorkBuddyAccountError('account-not-found')
    return { ...captured, id, credentialRevision: credentialRevision(account.credential), credential: { ...account.credential, source: 'dsh' } }
  }

  /** Refresh-token CAS is independent of selection and cannot overwrite another writer's rotation. */
  async commitSavedRefresh(captured: SavedAccountCapture, credential: WorkBuddyCredential): Promise<void> {
    await this.locked(async document => {
      this.checkSnapshot(document, captured)
      const account = document.accounts.find(value => value.id === captured.id)
      if (account === undefined || credentialRevision(account.credential) !== captured.credentialRevision) throw new WorkBuddyAccountError('account-selection-changed')
      if (!validCredential(credential) || identity(this.region, credential) !== captured.id || regionOf(credential.domain) !== this.region) throw new WorkBuddyAccountError('account-region-mismatch')
      account.credential = { ...credential }
      await this.write(document)
    })
  }

  /** Commit a refresh only while the durable selection still matches its capture. */
  async commitRefresh(selection: AccountSelection, credential: WorkBuddyCredential, saveDesktop: () => Promise<void>): Promise<void> {
    await this.locked(async document => {
      if (selection.revision !== document.revision || selection.selectedId !== document.selectedId) throw new WorkBuddyAccountError('account-selection-changed')
      if (selection.selectedId === null) { await saveDesktop(); return }
      const capturedRevision = (selection as Partial<AccountSnapshot>).credentialRevision
      if (capturedRevision !== undefined && credentialRevision(document.accounts.find(account => account.id === selection.selectedId)!.credential) !== capturedRevision) throw new WorkBuddyAccountError('account-selection-changed')
      if (regionOf(credential.domain) !== this.region) throw new WorkBuddyAccountError('account-region-mismatch')
      if (!validCredential(credential) || identity(this.region, credential) !== selection.selectedId) throw new WorkBuddyAccountError('account-state-invalid')
      document.accounts.find(account => account.id === selection.selectedId)!.credential = credential
      await this.write(document)
    })
  }
}
