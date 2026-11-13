import { ToolkitToolError, requireToolkitApproval, toolkitJsonOutput, toolkitObject, toolkitThrowIfCancelled, type ToolkitApproval, type ToolkitToolDefinition, type ToolkitToolExecution } from './host-tools.ts'
import { mediaRequestBody, validateMediaRequest, type MediaAccess, type MediaRequest, type MediaScope, type WorkBuddyMediaClient } from './media-client.ts'
import type { MediaTask, MediaTaskStore } from './media-task-store.ts'
import { regionOf } from './upstream.ts'
import { workbuddySavedAccountId } from './account-store.ts'
import { createHash } from 'node:crypto'

export interface MediaToolOptions {
  tasks: MediaTaskStore
  client: WorkBuddyMediaClient
  scope(): Promise<MediaScope | undefined>
  enabled(kind: 'image' | 'video', scope: MediaScope): Promise<boolean>
  /** Server-only resolution; undefined request means a read-only task query needing no model. */
  resolveAccess(scope: MediaScope, request: MediaRequest | undefined, signal: AbortSignal): Promise<MediaAccess>
  approval?: ToolkitApproval
  prefix?: string
}

function sameScope(a: MediaScope, b: MediaScope | undefined): boolean {
  return b !== undefined && a.account === b.account && a.region === b.region && a.revision === b.revision
}

export class WorkBuddyMediaService {
  private controllers = { image: new AbortController(), video: new AbortController() }
  private disposed = false
  constructor(private readonly options: MediaToolOptions) {}
  /** Disabling or unloading the integration cancels outstanding work without a replacement submission. */
  dispose(): void { this.disposed = true; this.cancel() }
  /** A settings change may cancel one capability without permanently disabling later explicit actions. */
  cancel(kind?: 'image' | 'video'): void {
    for (const key of kind === undefined ? ['image', 'video'] as const : [kind]) {
      this.controllers[key].abort()
      this.controllers[key] = new AbortController()
    }
  }
  async submit(kind: 'image' | 'video', args: unknown, execution: ToolkitToolExecution): Promise<MediaTask> {
    const input = toolkitObject(args, ['mode', 'prompt', 'model', 'images', 'firstFrame', 'lastFrame', 'size', 'quality', 'duration', 'resolution', 'aspectRatio', 'negativePrompt', 'audio'], ['mode', 'prompt'])
    const request = validateMediaRequest({ ...input, kind })
    const scope = await this.scope(kind)
    if (!execution.callId || execution.callId.length > 256) throw new ToolkitToolError('media-call-id-unavailable')
    const sessionId = hostSessionId(execution.agent)
    const operation = createHash('sha256').update(JSON.stringify([sessionId, execution.callId])).digest('hex')
    const signal = AbortSignal.any([execution.signal, this.controllers[kind].signal])
    toolkitThrowIfCancelled(signal)
    const access = await this.options.resolveAccess(scope, request, signal)
    await this.assertCurrent(scope, kind, signal)
    this.assertIdentity(scope, access)
    const body = mediaRequestBody(access, request)
    const requestFingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    const previous = await this.options.tasks.findOperation(scope, operation, kind, requestFingerprint)
    if (previous !== undefined) return previous
    const inputCount = request.images?.length ?? (request.firstFrame === undefined ? 0 : request.lastFrame === undefined ? 1 : 2)
    const reason = `Provider ${scope.region === 'cn' ? 'workbuddy' : 'workbuddy-ai'}; account ${scope.account}; model ${access.model!.id}; ${kind}/${request.mode}; ${inputCount} image inputs; prompt ${JSON.stringify(approvalPrompt(request.prompt))}. This action may consume account credits.`
    await requireToolkitApproval(this.options.approval, { ...execution, signal }, `${this.options.prefix ?? 'workbuddy'}_${kind}`, reason)
    await this.assertCurrent(scope, kind, signal)
    this.assertIdentity(scope, access)
    const admission = await this.options.tasks.prepare(scope, operation, kind, requestFingerprint)
    if (!admission.fresh) return admission.task
    // The persisted unknown record survives a process exit or a response lost after upstream accepted it.
    try {
      await this.assertCurrent(scope, kind, signal)
      const result = await this.options.client.submit(access, request, signal)
      return await this.options.tasks.record(scope, admission.task.id, result)
    } catch (error) {
      return this.options.tasks.record(scope, admission.task.id, { status: error instanceof ToolkitToolError && error.code === 'media-upstream-rejected' ? 'failed' : 'unknown', files: [] })
    }
  }
  async query(args: unknown, execution: ToolkitToolExecution): Promise<MediaTask> {
    const a = toolkitObject(args, ['taskId'], ['taskId'])
    if (typeof a['taskId'] !== 'string' || !/^[a-f0-9]{64}$/u.test(a['taskId'])) throw new ToolkitToolError('invalid-media-task')
    const scope = await this.options.scope()
    if (scope === undefined) throw new ToolkitToolError('media-account-unavailable')
    const task = await this.options.tasks.get(scope, a['taskId'])
    if (task === undefined) throw new ToolkitToolError('media-task-not-found')
    const signal = AbortSignal.any([execution.signal, this.controllers[task.kind].signal])
    await this.assertCurrent(scope, task.kind, signal)
    if (task.status === 'completed' || task.status === 'failed' || task.upstreamTaskId === undefined) return task
    const access = await this.options.resolveAccess(scope, undefined, signal)
    await this.assertCurrent(scope, task.kind, signal)
    this.assertIdentity(scope, access)
    try {
      const result = await this.options.client.query(access, task.kind, task.upstreamTaskId, signal)
      return await this.options.tasks.record(scope, task.id, result)
    } catch { return this.options.tasks.record(scope, task.id, { status: 'unknown', files: [] }) }
  }
  private async scope(kind: 'image' | 'video'): Promise<MediaScope> {
    if (this.disposed) throw new ToolkitToolError('media-disabled')
    const scope = await this.options.scope()
    if (scope === undefined) throw new ToolkitToolError('media-account-unavailable')
    if (!await this.options.enabled(kind, scope)) throw new ToolkitToolError('media-disabled')
    return scope
  }
  private assertIdentity(scope: MediaScope, access: MediaAccess): void {
    if (regionOf(access.credential.domain) !== scope.region) throw new ToolkitToolError('media-region-mismatch')
    if (workbuddySavedAccountId(scope.region, access.credential) !== scope.account) throw new ToolkitToolError('media-account-changed')
  }
  private async assertCurrent(scope: MediaScope, kind: 'image' | 'video', signal: AbortSignal): Promise<void> {
    toolkitThrowIfCancelled(signal)
    if (this.disposed) throw new ToolkitToolError('media-disabled')
    if (!sameScope(scope, await this.options.scope())) throw new ToolkitToolError('media-account-changed')
    if (!await this.options.enabled(kind, scope)) throw new ToolkitToolError('media-disabled')
    toolkitThrowIfCancelled(signal)
  }
}

function approvalPrompt(prompt: string): string {
  return prompt.replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/(?:https?:\/\/\S+|[a-z]:[\\/]\S+|(?:^|\s)\/[\w.-]+\/\S*|data:image\/\S+)/giu, '[input]')
    .replace(/(?:Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b[A-Za-z0-9_-]{24,}\b)/gu, '[redacted]')
    .slice(0, 160)
}

function hostSessionId(agent: unknown): string {
  try {
    if (typeof agent !== 'object' || agent === null) throw new Error()
    const session = (agent as { session?: unknown }).session
    if (typeof session !== 'object' || session === null) throw new Error()
    const id = (session as { id?: unknown }).id
    if (typeof id !== 'string' || id === '' || id.length > 256 || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error()
    return id
  } catch { throw new ToolkitToolError('media-session-unavailable') }
}

/** Separate tools keep image/video approvals and activation independent; task lookup cannot submit. */
export function createMediaTools(options: MediaToolOptions, service: WorkBuddyMediaService = new WorkBuddyMediaService(options)): ToolkitToolDefinition[] {
  const prefix = options.prefix ?? 'workbuddy'
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(prefix)) throw new ToolkitToolError('invalid-tool-prefix')
  const text = { type: 'string' }
  const properties: Record<string, unknown> = { mode: { type: 'string', enum: ['text', 'edit', 'frame'] }, prompt: text, model: text,
    images: { type: 'array', items: text, minItems: 1, maxItems: 4 }, firstFrame: text, lastFrame: text, size: text, quality: text,
    duration: { type: 'number', minimum: 1, maximum: 120 }, resolution: text, aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'] }, negativePrompt: text, audio: { type: 'boolean' } }
  return [
    ...(['image', 'video'] as const).map(kind => ({
      name: `${prefix}_${kind}`, description: `Submit one approved ${kind} generation${kind === 'image' ? ' or edit' : ' from text or frames'} using the active account. Disabled by default. May consume credits. Unknown outcomes must be queried; never regenerate because a timeout occurred. Image edits accept bounded image data URIs; frame video accepts HTTPS image URLs or data URIs.`,
      parameters: { type: 'object', additionalProperties: false, properties: { ...properties, mode: { type: 'string', enum: kind === 'image' ? ['text', 'edit'] : ['text', 'frame'] } }, required: ['mode', 'prompt'] },
      output: toolkitJsonOutput(), execute: (args: unknown, execution: ToolkitToolExecution) => safe(() => service.submit(kind, args, execution)),
    })),
    { name: `${prefix}_media_task`, description: 'Query one previously saved media task for the active account. Makes at most one status request, never submits a new generation.', parameters: { type: 'object', additionalProperties: false, properties: { taskId: text }, required: ['taskId'] }, output: toolkitJsonOutput(), execute: (args, execution) => safe(() => service.query(args, execution)) },
  ]
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) { if (error instanceof ToolkitToolError) throw error; throw new ToolkitToolError('media-unavailable') }
}
