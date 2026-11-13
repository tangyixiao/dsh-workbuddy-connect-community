import type { WorkBuddyCredential } from './auth.ts'
import { regionOf, type WorkBuddyRegion } from './upstream.ts'
import { ToolkitToolError, toolkitObject, toolkitThrowIfCancelled } from './host-tools.ts'

/** Mode tags and videoGeneration fields come from the official CodeBuddy Image/VideoService. */
export interface MediaModel {
  id: string
  tags: readonly string[]
  videoGeneration?: { minSeconds?: number, maxSeconds?: number, defaultSeconds?: number, resolutions?: readonly string[], defaultResolution?: string }
}
export interface MediaScope { region: WorkBuddyRegion, account: string, revision: string }
export type MediaEndpoint = 'https://www.workbuddy.cn' | 'https://copilot.tencent.com' | 'https://www.workbuddy.ai'
export interface MediaAccess { credential: WorkBuddyCredential, model?: MediaModel, endpoint?: MediaEndpoint }
export interface MediaRequest {
  kind: 'image' | 'video'
  mode: 'text' | 'edit' | 'frame'
  prompt: string
  model?: string
  images?: string[]
  firstFrame?: string
  lastFrame?: string
  size?: string
  quality?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  negativePrompt?: string
  audio?: boolean
}
export interface MediaFile { url?: string, base64?: string, localPath?: string }
export interface MediaResult { upstreamTaskId?: string, status: 'pending' | 'completed' | 'failed' | 'unknown', files: MediaFile[] }
const REQUEST_KEYS = ['kind', 'mode', 'prompt', 'model', 'images', 'firstFrame', 'lastFrame', 'size', 'quality', 'duration', 'resolution', 'aspectRatio', 'negativePrompt', 'audio']
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function invalid(): never { throw new ToolkitToolError('invalid-media-input') }
function imageInput(value: unknown, allowUrl: boolean): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) return false
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) return true
  if (!allowUrl || value.length > 8192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && publicHost(url.hostname)
  } catch { return false }
}
function publicHost(host: string): boolean {
  return !/^(?:localhost|.*\.localhost|.*\.local|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|::)/iu.test(host)
}

/** Reject invalid/unsupported shapes before approval, credential resolution or billing. */
export function validateMediaRequest(value: unknown): MediaRequest {
  const a = toolkitObject(value, REQUEST_KEYS, ['kind', 'mode', 'prompt'])
  if (a['mode'] === 'reference') throw new ToolkitToolError('media-mode-unsupported')
  if (a['kind'] !== 'image' && a['kind'] !== 'video') invalid()
  const image = a['kind'] === 'image'
  if (image ? !['text', 'edit'].includes(String(a['mode'])) : !['text', 'frame'].includes(String(a['mode']))) invalid()
  if (typeof a['prompt'] !== 'string' || a['prompt'].length > (image ? 16_000 : 2500) || (a['mode'] !== 'frame' && a['prompt'].trim() === '')) invalid()
  const allowed = image ? ['kind', 'mode', 'prompt', 'model', 'size', 'quality', ...(a['mode'] === 'edit' ? ['images'] : [])]
    : ['kind', 'mode', 'prompt', 'model', 'duration', 'resolution', 'aspectRatio', 'negativePrompt', 'audio', ...(a['mode'] === 'frame' ? ['firstFrame', 'lastFrame'] : [])]
  if (Object.keys(a).some(k => !allowed.includes(k))) invalid()
  for (const key of ['model', 'size', 'quality', 'resolution', 'aspectRatio', 'negativePrompt']) {
    if (a[key] !== undefined && (typeof a[key] !== 'string' || (a[key] as string).length > (key === 'negativePrompt' ? 2500 : 128))) invalid()
  }
  if (a['model'] !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/u.test(String(a['model']))) invalid()
  if (a['size'] !== undefined && !/^\d{2,5}x\d{2,5}$/u.test(String(a['size']))) invalid()
  if (a['duration'] !== undefined && (typeof a['duration'] !== 'number' || !Number.isFinite(a['duration']) || a['duration'] <= 0 || a['duration'] > 120)) invalid()
  if (a['audio'] !== undefined && typeof a['audio'] !== 'boolean') invalid()
  if (a['aspectRatio'] !== undefined && !['16:9', '9:16', '1:1'].includes(String(a['aspectRatio']))) invalid()
  if (a['mode'] === 'edit' && (!Array.isArray(a['images']) || a['images'].length < 1 || a['images'].length > 4 || !a['images'].every(v => imageInput(v, false)))) invalid()
  if (a['mode'] === 'frame' && (!imageInput(a['firstFrame'], true) || (a['lastFrame'] !== undefined && !imageInput(a['lastFrame'], true)))) invalid()
  return structuredClone(a) as unknown as MediaRequest
}

/** Build a billed request only when the account's current official catalog declares its mode. */
export function mediaRequestBody(access: MediaAccess, request: MediaRequest): Record<string, unknown> {
  const mode = request.kind === 'image' ? request.mode === 'edit' ? 'image-to-image' : 'text-to-image' : request.mode === 'frame' ? 'image-to-video' : 'text-to-video'
  if (access.model === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/u.test(access.model.id) || !Array.isArray(access.model.tags) || !access.model.tags.includes(mode) || (request.model !== undefined && request.model !== access.model.id)) throw new ToolkitToolError('media-model-unavailable')
  const model = access.model.id
  if (request.kind === 'image') {
    const body: Record<string, unknown> = { model, prompt: request.prompt, size: request.size || '1024x1024' }
    if (model.startsWith('hunyuan-')) body['n'] = 1
    else if (!model.startsWith('gemini-')) {
      body['response_format'] = 'b64_json'
      if (request.quality !== undefined) body['quality'] = request.quality
    }
    if (request.mode === 'edit') body['image'] = request.images
    return body
  }
  const v = access.model.videoGeneration
  // Official VideoService defaults (Y/Z in the inspected installed bundle), applied only
  // after the current catalog declares this exact mode. Duration still needs a declaration.
  const resolutions = v?.resolutions ?? ['720P', '1080P']
  const defaultResolution = v?.defaultResolution ?? '1080P'
  if (v === undefined || v.defaultSeconds === undefined || !resolutions.includes(defaultResolution)) throw new ToolkitToolError('media-model-metadata-unavailable')
  const seconds = request.duration ?? v.defaultSeconds
  if (!Number.isFinite(seconds) || seconds <= 0 || (request.duration !== undefined && (v.minSeconds === undefined || v.maxSeconds === undefined))
    || (v.minSeconds !== undefined && seconds < v.minSeconds) || (v.maxSeconds !== undefined && seconds > v.maxSeconds)) invalid()
  const resolution = request.resolution ?? defaultResolution
  if (!resolutions.includes(resolution)) invalid()
  return {
    model, prompt: request.prompt, seconds, negative_prompt: request.negativePrompt ?? '', watermark: true,
    ...(request.mode === 'frame' ? { image_url: request.firstFrame, ...(request.lastFrame === undefined ? {} : { last_image_url: request.lastFrame }) } : {}),
    extra_parameters: { resolution, enable_audio: request.audio ?? true, ...(request.mode === 'text' ? { aspect_ratio: request.aspectRatio ?? '16:9' } : {}) },
  }
}

export class WorkBuddyMediaClient {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  constructor(options: { fetch?: typeof fetch, timeoutMs?: number } = {}) {
    this.fetcher = options.fetch ?? fetch
    this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 30_000, 60_000))
  }
  async submit(access: MediaAccess, request: MediaRequest, signal: AbortSignal): Promise<MediaResult> {
    const valid = validateMediaRequest(request)
    const body = mediaRequestBody(access, valid)
    const path = valid.kind === 'video' ? '/v2/videos/generations' : valid.mode === 'edit' ? '/v2/images/edits' : '/v2/images/generations'
    const result = await this.post(access, path, body, signal)
    if (valid.kind === 'video') {
      if (typeof result['id'] !== 'string' || !/^[a-zA-Z0-9_.:-]{1,256}$/u.test(result['id'])) throw new ToolkitToolError('media-outcome-unknown')
      return { upstreamTaskId: result['id'], status: 'pending', files: [] }
    }
    return { status: 'completed', files: filesOf(result['data']) }
  }
  /** One request, no polling loop, no submit fallback. */
  async query(access: MediaAccess, kind: 'image' | 'video', id: string, signal: AbortSignal): Promise<MediaResult> {
    if (kind !== 'video') throw new ToolkitToolError('media-query-unsupported')
    if (!/^[a-zA-Z0-9_.:-]{1,256}$/u.test(id)) invalid()
    const result = await this.post(access, '/v2/videos/tasks', { task_id: id }, signal)
    const status = result['status']
    return { status: status === 'completed' || status === 'failed' ? status : typeof status === 'string' ? 'pending' : 'unknown', files: status === 'completed' ? filesOf(result['data']) : [] }
  }
  private async post(access: MediaAccess, path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    toolkitThrowIfCancelled(signal)
    const c = access.credential
    const base = access.endpoint ?? (regionOf(c.domain) === 'global' ? 'https://www.workbuddy.ai' : 'https://www.workbuddy.cn')
    if (regionOf(c.domain) === 'global' ? base !== 'https://www.workbuddy.ai' : !['https://www.workbuddy.cn', 'https://copilot.tencent.com'].includes(base)) throw new ToolkitToolError('media-region-mismatch')
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const active = AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await abortable(this.fetcher(`${base}${path}`, { method: 'POST', redirect: 'error', signal: active, headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${c.accessToken}`,
        ...(c.uid ? { 'X-User-Id': c.uid } : {}), ...(c.enterpriseId ? { 'X-Enterprise-Id': c.enterpriseId } : {}), ...(c.domain ? { 'X-Domain': c.domain } : {}),
      }, body: JSON.stringify(body) }), active)
    } catch { throw new ToolkitToolError('media-outcome-unknown') }
    if (!response.ok) throw new ToolkitToolError('media-outcome-unknown')
    try {
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error()
      let text = ''
      let bytes = 0
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const chunk = await abortable(reader.read(), active)
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 32 * 1024 * 1024) throw new Error()
          text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
      } finally { void reader.cancel().catch(() => {}) }
      const envelope = JSON.parse(text) as Record<string, unknown>
      if (envelope['code'] !== 0) throw new ToolkitToolError('media-upstream-rejected')
      if (typeof envelope['data'] !== 'object' || envelope['data'] === null || Array.isArray(envelope['data'])) throw new Error()
      return envelope['data'] as Record<string, unknown>
    } catch (e) { if (e instanceof ToolkitToolError) throw e; throw new ToolkitToolError('media-outcome-unknown') }
  }
}

/** Also bounds injected transports/readers that do not implement AbortSignal themselves. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new ToolkitToolError('cancelled'))
    if (signal.aborted) { void operation.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {})
  })
}

function filesOf(raw: unknown): MediaFile[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) throw new ToolkitToolError('media-outcome-unknown')
  return raw.map((file: unknown) => {
    if (typeof file !== 'object' || file === null) throw new ToolkitToolError('media-outcome-unknown')
    const f = file as Record<string, unknown>
    if (typeof f['b64_json'] === 'string' && f['b64_json'].length > 0 && f['b64_json'].length <= Math.ceil(MAX_IMAGE_BYTES * 4 / 3) && /^[A-Za-z0-9+/]+={0,2}$/u.test(f['b64_json'])) return { base64: f['b64_json'] }
    if (typeof f['url'] === 'string' && imageInput(f['url'], true) && f['url'].startsWith('https:')) return { url: f['url'] }
    throw new ToolkitToolError('media-outcome-unknown')
  })
}
