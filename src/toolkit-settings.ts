/** Owner-configured per-provider/account capabilities. Missing settings always disable effects. */
import { randomUUID } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { dirname, isAbsolute, win32 } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { WorkBuddyRegion } from './upstream.ts'

export interface ToolkitSettings {
  revision: string
  features: { images: boolean; videos: boolean; cli: boolean; contextRescue: boolean }
  automation: { rotate: boolean; checkin: boolean; members: string[]; maxSwitches: number }
  cli: { workspace: string; model: string; effort: string; timeoutMs: number; maxTurns: number }
}
export interface ToolkitSettingsPatch {
  features?: Partial<ToolkitSettings['features']>
  automation?: Partial<ToolkitSettings['automation']>
  cli?: Partial<ToolkitSettings['cli']>
}
export class ToolkitSettingsError extends Error {
  constructor(readonly code: 'toolkit-account-invalid' | 'toolkit-settings-invalid' | 'toolkit-revision-changed' | 'toolkit-state-invalid' | 'toolkit-storage-unavailable') { super(code) }
}
const MAX_BYTES = 1_048_576
const MAX_ACCOUNTS = 100
const EFFORTS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key))
}
export function toolkitAccountIdValid(id: unknown, region: WorkBuddyRegion): id is string {
  return typeof id === 'string' && new RegExp(`^${region}-[a-f0-9]{32}$`, 'u').test(id)
}
export function defaultToolkitSettings(): ToolkitSettings {
  return {
    revision: 'initial',
    features: { images: false, videos: false, cli: false, contextRescue: false },
    automation: { rotate: false, checkin: false, members: [], maxSwitches: 1 },
    cli: { workspace: '', model: '', effort: '', timeoutMs: 60_000, maxTurns: 3 },
  }
}
function validSettings(value: unknown, region: WorkBuddyRegion): value is ToolkitSettings {
  if (!record(value) || !keys(value, ['revision', 'features', 'automation', 'cli'])
    || typeof value['revision'] !== 'string' || !/^(initial|[a-f0-9-]{36})$/u.test(value['revision'])) return false
  const features = value['features']; const automation = value['automation']; const cli = value['cli']
  if (!record(features) || !keys(features, ['images', 'videos', 'cli', 'contextRescue'])
    || !['images', 'videos', 'cli', 'contextRescue'].every(key => typeof features[key] === 'boolean')) return false
  if (!record(automation) || !keys(automation, ['rotate', 'checkin', 'members', 'maxSwitches'])
    || typeof automation['rotate'] !== 'boolean' || typeof automation['checkin'] !== 'boolean'
    || !Number.isInteger(automation['maxSwitches']) || (automation['maxSwitches'] as number) < 1 || (automation['maxSwitches'] as number) > 3
    || !Array.isArray(automation['members']) || automation['members'].length > 16
    || !automation['members'].every(id => toolkitAccountIdValid(id, region)) || new Set(automation['members']).size !== automation['members'].length) return false
  if (!record(cli) || !keys(cli, ['workspace', 'model', 'effort', 'timeoutMs', 'maxTurns'])
    || typeof cli['workspace'] !== 'string' || cli['workspace'].length > 4096 || /[\u0000-\u001f\u007f]/u.test(cli['workspace'])
    || (cli['workspace'] !== '' && !isAbsolute(cli['workspace']) && !win32.isAbsolute(cli['workspace']))
    || typeof cli['model'] !== 'string' || cli['model'].length > 128 || (cli['model'] !== '' && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(cli['model']))
    || typeof cli['effort'] !== 'string' || !EFFORTS.includes(cli['effort'])
    || !Number.isInteger(cli['timeoutMs']) || (cli['timeoutMs'] as number) < 10_000 || (cli['timeoutMs'] as number) > 300_000
    || !Number.isInteger(cli['maxTurns']) || (cli['maxTurns'] as number) < 1 || (cli['maxTurns'] as number) > 4) return false
  return !features['cli'] || (cli['workspace'] !== '' && cli['model'] !== '' && cli['effort'] !== '' && cli['effort'] !== 'off')
}
interface Document { version: 1; region: WorkBuddyRegion; accounts: Record<string, ToolkitSettings> }

/** Reads are authoritative; no enabled in-memory state can outrun the durable commit. */
export class ToolkitSettingsStore {
  constructor(private readonly path: string, private readonly region: WorkBuddyRegion) {}
  private account(account: string): void {
    if (!toolkitAccountIdValid(account, this.region)) throw new ToolkitSettingsError('toolkit-account-invalid')
  }
  private async read(): Promise<Document> {
    try {
      const handle = await open(this.path, 'r')
      let text: string
      try {
        const size = (await handle.stat()).size
        if (size > MAX_BYTES) throw new ToolkitSettingsError('toolkit-state-invalid')
        const bytes = Buffer.alloc(size + 1)
        const read = await handle.read(bytes, 0, bytes.length, 0)
        if (read.bytesRead > size) throw new ToolkitSettingsError('toolkit-state-invalid')
        text = bytes.subarray(0, read.bytesRead).toString('utf8')
      } finally { await handle.close() }
      const value: unknown = JSON.parse(text)
      if (!record(value) || !keys(value, ['version', 'region', 'accounts']) || value['version'] !== 1 || value['region'] !== this.region
        || !record(value['accounts']) || Object.keys(value['accounts']).length > MAX_ACCOUNTS
        || !Object.entries(value['accounts']).every(([id, settings]) => toolkitAccountIdValid(id, this.region) && validSettings(settings, this.region))) throw new ToolkitSettingsError('toolkit-state-invalid')
      return value as unknown as Document
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: 1, region: this.region, accounts: {} }
      throw error instanceof ToolkitSettingsError ? error : new ToolkitSettingsError('toolkit-state-invalid')
    }
  }
  async get(account: string): Promise<ToolkitSettings> {
    this.account(account)
    return structuredClone((await this.read()).accounts[account] ?? defaultToolkitSettings())
  }
  async update(account: string, patch: unknown, expectedRevision: string): Promise<ToolkitSettings> {
    this.account(account)
    if (!record(patch) || !keys(patch, ['features', 'automation', 'cli']) || Object.keys(patch).length === 0) throw new ToolkitSettingsError('toolkit-settings-invalid')
    for (const [name, allowed] of [['features', ['images', 'videos', 'cli', 'contextRescue']], ['automation', ['rotate', 'checkin', 'members', 'maxSwitches']], ['cli', ['workspace', 'model', 'effort', 'timeoutMs', 'maxTurns']]] as const) {
      const group = patch[name]
      if (Object.hasOwn(patch, name) && (!record(group) || !keys(group, [...allowed]))) throw new ToolkitSettingsError('toolkit-settings-invalid')
    }
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      return await withFileLock(this.path, async () => {
        const document = await this.read()
        const previous = document.accounts[account] ?? defaultToolkitSettings()
        if (previous.revision !== expectedRevision) throw new ToolkitSettingsError('toolkit-revision-changed')
        const next = {
          revision: randomUUID(),
          features: { ...previous.features, ...patch['features'] as object },
          automation: { ...previous.automation, ...patch['automation'] as object },
          cli: { ...previous.cli, ...patch['cli'] as object },
        }
        if (!validSettings(next, this.region)) throw new ToolkitSettingsError('toolkit-settings-invalid')
        if (document.accounts[account] === undefined && Object.keys(document.accounts).length >= MAX_ACCOUNTS) throw new ToolkitSettingsError('toolkit-settings-invalid')
        document.accounts[account] = structuredClone(next)
        const text = `${JSON.stringify(document)}\n`
        if (Buffer.byteLength(text) > MAX_BYTES) throw new ToolkitSettingsError('toolkit-settings-invalid')
        await writeFileAtomic(this.path, text, { mode: 0o600, dirMode: 0o700 })
        return structuredClone(next)
      })
    } catch (error) { throw error instanceof ToolkitSettingsError ? error : new ToolkitSettingsError('toolkit-storage-unavailable') }
  }
}
