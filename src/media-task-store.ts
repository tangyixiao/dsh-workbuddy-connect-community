import { createHash } from 'node:crypto'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ToolkitToolError } from './host-tools.ts'
import type { MediaFile, MediaResult, MediaScope } from './media-client.ts'
import { toolkitAccountIdValid } from './toolkit-settings.ts'

export interface MediaTask {
  id: string
  kind: 'image' | 'video'
  status: MediaResult['status']
  upstreamTaskId?: string
  files: MediaFile[]
}
interface SavedTask extends MediaTask { scope: MediaScope, operation: string, requestFingerprint?: string, updatedAtMs: number }
interface Document { version: 1, tasks: SavedTask[] }
const MAX_TASKS = 256
const MAX_STATE_BYTES = 2 * 1024 * 1024

function sameAccount(a: MediaScope, b: MediaScope): boolean { return a.region === b.region && a.account === b.account }
function dto(task: SavedTask): MediaTask {
  return { id: task.id, kind: task.kind, status: task.status, files: structuredClone(task.files), ...(task.upstreamTaskId === undefined ? {} : { upstreamTaskId: task.upstreamTaskId }) }
}
function validScope(scope: MediaScope): boolean {
  return scope !== null && typeof scope === 'object' && ['cn', 'global'].includes(scope.region) && toolkitAccountIdValid(scope.account, scope.region) && typeof scope.revision === 'string' && scope.revision.length > 0 && scope.revision.length <= 512
}

/** Durable unknown-before-submit admission. Corruption and exhausted storage fail closed. */
export class MediaTaskStore {
  private readonly path: string
  constructor(path: string) { this.path = resolve(path) }
  async prepare(scope: MediaScope, operation: string, kind: 'image' | 'video', requestFingerprint?: string): Promise<{ task: MediaTask, fresh: boolean }> {
    if (!validScope(scope) || !operation || operation.length > 256 || !['image', 'video'].includes(kind) || (requestFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(requestFingerprint))) throw new ToolkitToolError('invalid-media-scope')
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const document = await this.read()
      // A selected-account revision change does not turn an already admitted operation into a new bill.
      const existing = document.tasks.find(t => sameAccount(t.scope, scope) && t.operation === operation)
      if (existing !== undefined) {
        if (existing.kind !== kind || existing.requestFingerprint !== requestFingerprint) throw new ToolkitToolError('media-operation-changed')
        return { task: dto(existing), fresh: false }
      }
      if (document.tasks.length >= MAX_TASKS) throw new ToolkitToolError('media-task-capacity')
      const id = createHash('sha256').update(JSON.stringify([scope.region, scope.account, operation])).digest('hex')
      const task: SavedTask = { id, kind, status: 'unknown', files: [], scope: { ...scope }, operation, ...(requestFingerprint === undefined ? {} : { requestFingerprint }), updatedAtMs: Date.now() }
      document.tasks.push(task)
      await this.save(document)
      return { task: dto(task), fresh: true }
    })
  }
  /** Inspect a logical call without reserving an unapproved new operation. */
  async findOperation(scope: MediaScope, operation: string, kind: 'image' | 'video', requestFingerprint: string): Promise<MediaTask | undefined> {
    if (!validScope(scope) || !operation || operation.length > 256 || !/^[a-f0-9]{64}$/u.test(requestFingerprint)) throw new ToolkitToolError('invalid-media-scope')
    const existing = (await this.read()).tasks.find(t => sameAccount(t.scope, scope) && t.operation === operation)
    if (existing === undefined) return undefined
    if (existing.kind !== kind || existing.requestFingerprint !== requestFingerprint) throw new ToolkitToolError('media-operation-changed')
    return dto(existing)
  }
  async get(scope: MediaScope, id: string): Promise<MediaTask | undefined> {
    if (!validScope(scope) || !/^[a-f0-9]{64}$/u.test(id)) return undefined
    const found = (await this.read()).tasks.find(t => t.id === id && sameAccount(scope, t.scope))
    return found === undefined ? undefined : dto(found)
  }
  async list(scope: MediaScope): Promise<MediaTask[]> {
    if (!validScope(scope)) return []
    return (await this.read()).tasks.filter(t => sameAccount(scope, t.scope)).map(dto)
  }
  async record(scope: MediaScope, id: string, result: MediaResult): Promise<MediaTask> {
    if (!validScope(scope) || !['pending', 'completed', 'failed', 'unknown'].includes(result.status) || !Array.isArray(result.files) || result.files.length > 4
      || (result.upstreamTaskId !== undefined && !/^[a-zA-Z0-9_.:-]{1,256}$/u.test(result.upstreamTaskId))
      || result.files.some(f => typeof f !== 'object' || f === null || (f.base64 !== undefined ? typeof f.base64 !== 'string' || f.base64.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(f.base64) : !validResultUrl(f.url)))) throw new ToolkitToolError('media-state-unavailable')
    return withFileLock(this.path, async () => {
      const document = await this.read()
      const task = document.tasks.find(t => t.id === id && sameAccount(scope, t.scope))
      if (task === undefined) throw new ToolkitToolError('media-task-not-found')
      if (task.status === 'completed' || task.status === 'failed') return dto(task)
      const files: MediaFile[] = []
      for (const [i, file] of result.files.entries()) {
        if (file.base64 !== undefined) {
          const directory = join(dirname(this.path), 'workbuddy-media', id)
          await mkdir(directory, { recursive: true, mode: 0o700 })
          const path = join(directory, `${i}.png`)
          // Generated bytes only; no provider/model supplied filesystem path is ever accepted.
          await writeFile(path, Buffer.from(file.base64, 'base64'), { mode: 0o600, flag: 'wx' }).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          })
          files.push({ localPath: path })
        } else if (file.url !== undefined) files.push({ url: file.url })
      }
      task.status = result.status
      task.files = files
      if (result.upstreamTaskId !== undefined) task.upstreamTaskId = result.upstreamTaskId
      task.updatedAtMs = Date.now()
      await this.save(document)
      return dto(task)
    })
  }
  private async read(): Promise<Document> {
    let text: string
    try {
      const handle = await open(this.path, 'r')
      try {
        const size = (await handle.stat()).size
        if (size > MAX_STATE_BYTES) throw new ToolkitToolError('media-state-unavailable')
        const bytes = Buffer.alloc(size + 1)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > size) throw new ToolkitToolError('media-state-unavailable')
        text = bytes.subarray(0, bytesRead).toString('utf8')
      } finally { await handle.close() }
    }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tasks: [] }; throw new ToolkitToolError('media-state-unavailable') }
    try {
      if (text.length > MAX_STATE_BYTES) throw new Error()
      const d = JSON.parse(text) as Document
      if (d.version !== 1 || !Array.isArray(d.tasks) || d.tasks.length > MAX_TASKS) throw new Error()
      const ids = new Set<string>()
      for (const t of d.tasks) {
        if (!t || !validScope(t.scope) || !/^[a-f0-9]{64}$/u.test(t.id) || ids.has(t.id) || typeof t.operation !== 'string' || t.operation.length > 256
          || !['image', 'video'].includes(t.kind) || !['pending', 'completed', 'failed', 'unknown'].includes(t.status) || !Array.isArray(t.files) || t.files.length > 4
          || t.files.some((f, index) => typeof f !== 'object' || f === null || f.base64 !== undefined || (f.url !== undefined ? !validResultUrl(f.url) : f.localPath !== join(dirname(this.path), 'workbuddy-media', t.id, `${index}.png`)))
          || (t.requestFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(t.requestFingerprint))
          || (t.upstreamTaskId !== undefined && !/^[a-zA-Z0-9_.:-]{1,256}$/u.test(t.upstreamTaskId))) throw new Error()
        ids.add(t.id)
      }
      return d
    } catch { throw new ToolkitToolError('media-state-unavailable') }
  }
  private async save(document: Document): Promise<void> {
    const text = JSON.stringify(document)
    if (text.length > MAX_STATE_BYTES) throw new ToolkitToolError('media-task-capacity')
    try { await writeFileAtomic(this.path, text, { mode: 0o600, dirMode: 0o700 }) }
    catch { throw new ToolkitToolError('media-state-unavailable') }
  }
}

function validResultUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password }
  catch { return false }
}
