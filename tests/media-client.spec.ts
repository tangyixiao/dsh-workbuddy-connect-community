import { describe, expect, it } from 'vitest'
import { WorkBuddyMediaClient, validateMediaRequest, type MediaEndpoint } from '../src/media-client.ts'

describe('official media transport', () => {
  it.each(['https://www.workbuddy.cn.attacker.invalid', 'https://attacker.invalid/https://www.workbuddy.cn', 'https://www.workbuddy.ai@attacker.invalid', 'https://www.workbuddy.ai'])('rejects a foreign or deceptive endpoint before sending credentials: %s', endpoint => {
    let calls = 0
    const client = new WorkBuddyMediaClient({ fetch: async () => { calls++; throw new Error('must not send') } })
    const access = { endpoint: endpoint as MediaEndpoint, credential: { accessToken: 'private', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'a', source: 'desktop' as const }, model: { id: 'hunyuan-image-v3.0', tags: ['text-to-image'] } }
    return expect(client.submit(access, validateMediaRequest({ kind: 'image', mode: 'text', prompt: 'x' }), new AbortController().signal)).rejects.toMatchObject({ code: 'media-region-mismatch' }).then(() => { expect(calls).toBe(0) })
  })

  it('uses the installed CodeBuddy video submit and one immediate query contracts', async () => {
    const requests: Array<{ url: string, body: unknown }> = []
    const client = new WorkBuddyMediaClient({ fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return Response.json(requests.length === 1 ? { code: 0, data: { id: 'video-1' } } : { code: 0, data: { status: 'completed', data: [{ url: 'https://media.example/result.mp4' }] } })
    } })
    const access = { credential: { accessToken: 'private-token', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'account', source: 'desktop' as const }, model: { id: 'kling-v3-t2v', tags: ['text-to-video'], videoGeneration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5, resolutions: ['720P', '1080P'], defaultResolution: '1080P' } } }
    const submitted = await client.submit(access, validateMediaRequest({ kind: 'video', mode: 'text', prompt: 'clouds' }), AbortSignal.timeout(1000))
    expect(submitted).toEqual({ upstreamTaskId: 'video-1', status: 'pending', files: [] })
    expect(await client.query(access, 'video', 'video-1', AbortSignal.timeout(1000))).toEqual({ status: 'completed', files: [{ url: 'https://media.example/result.mp4' }] })
    expect(requests).toEqual([
      { url: 'https://www.workbuddy.cn/v2/videos/generations', body: { model: 'kling-v3-t2v', prompt: 'clouds', seconds: 5, negative_prompt: '', watermark: true, extra_parameters: { resolution: '1080P', enable_audio: true, aspect_ratio: '16:9' } } },
      { url: 'https://www.workbuddy.cn/v2/videos/tasks', body: { task_id: 'video-1' } },
    ])
  })
  it('rejects credentials, paths and unsupported reference mode before a billable request', async () => {
    let calls = 0
    const client = new WorkBuddyMediaClient({ fetch: async () => { calls++; throw new Error('must not send') } })
    const access = { credential: { accessToken: 'private', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'a', source: 'desktop' as const }, model: { id: 'chat-model', tags: ['chat'] } }
    expect(() => validateMediaRequest({ kind: 'image', mode: 'text', prompt: 'x', tempKey: 'secret' })).toThrow('invalid-input')
    expect(() => validateMediaRequest({ kind: 'image', mode: 'edit', prompt: 'x', images: ['C:/Users/private/image.png'] })).toThrow('invalid-media-input')
    expect(() => validateMediaRequest({ kind: 'video', mode: 'reference', prompt: 'x' })).toThrow('media-mode-unsupported')
    await expect(client.submit(access, validateMediaRequest({ kind: 'image', mode: 'text', prompt: 'x' }), new AbortController().signal)).rejects.toMatchObject({ code: 'media-model-unavailable' })
    expect(calls).toBe(0)
  })
  it('translates bounded request timeout to unknown and never retries a submission', async () => {
    let calls = 0
    const client = new WorkBuddyMediaClient({ timeoutMs: 5, fetch: async () => { calls++; return new Promise<Response>(() => {}) } })
    const access = { credential: { accessToken: 'private', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'a', source: 'desktop' as const }, model: { id: 'hunyuan-image-v3.0', tags: ['text-to-image'] } }
    await expect(client.submit(access, validateMediaRequest({ kind: 'image', mode: 'text', prompt: 'x' }), new AbortController().signal)).rejects.toMatchObject({ code: 'media-outcome-unknown' })
    expect(calls).toBe(1)
  })
  it('uses the official image edit body and strips arbitrary provider response fields', async () => {
    let body: unknown
    const client = new WorkBuddyMediaClient({ fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ code: 0, data: { data: [{ b64_json: 'aW1hZ2U=', account: 'private', pid: 99 }], token: 'private' } }) } })
    const access = { credential: { accessToken: 'private', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'a', source: 'desktop' as const }, model: { id: 'hunyuan-image-v2.0-general-edit', tags: ['image-to-image'] } }
    expect(await client.submit(access, validateMediaRequest({ kind: 'image', mode: 'edit', prompt: 'red', images: ['data:image/png;base64,aW1hZ2U='] }), new AbortController().signal)).toEqual({ status: 'completed', files: [{ base64: 'aW1hZ2U=' }] })
    expect(body).toEqual({ model: 'hunyuan-image-v2.0-general-edit', prompt: 'red', size: '1024x1024', n: 1, image: ['data:image/png;base64,aW1hZ2U='] })
  })
  it('accepts the exact installed Kling declaration lacking optional resolution fields using official SDK defaults', async () => {
    let body: unknown
    const client = new WorkBuddyMediaClient({ fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ code: 0, data: { id: 'video-2' } }) } })
    const access = { credential: { accessToken: 'private', refreshToken: '', expiresAtMs: 1, domain: '', uid: 'a', source: 'desktop' as const }, model: { id: 'kling-v3-t2v', tags: ['text-to-video'], videoGeneration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5 } } }
    await client.submit(access, validateMediaRequest({ kind: 'video', mode: 'text', prompt: 'clouds' }), new AbortController().signal)
    expect(body).toEqual({ model: 'kling-v3-t2v', prompt: 'clouds', seconds: 5, negative_prompt: '', watermark: true, extra_parameters: { resolution: '1080P', enable_audio: true, aspect_ratio: '16:9' } })
  })
})
