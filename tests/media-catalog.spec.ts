import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkBuddyCredential } from '../src/auth.ts'
import { fallbackChatIdentity } from '../src/client-identity.ts'
import { mediaRequestBody, validateMediaRequest } from '../src/media-client.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'

afterEach(() => vi.unstubAllGlobals())

// Video declaration copied as facts from installed WorkBuddy's product metadata;
// resolution fields are intentionally absent, matching that declaration exactly.
const product = {
  agents: [{ id: 'cli', models: ['chat-only'] }],
  models: [
    { id: 'chat-only', tags: ['chat'] },
    { id: 'hunyuan-image-v3.0', tags: ['text-to-image', 'badge:preview'], billing: { free: true, credits: 'untrusted-price' }, privateField: 'not-a-media-field' },
    { id: 'kling-v3-t2v', tags: ['text-to-video'], videoGeneration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5 } },
    { id: 'kling-v3-i2v', tags: ['image-to-video'], videoGeneration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5, resolutions: ['720P'], defaultResolution: '720P' } },
  ],
}

function credential(region: 'cn' | 'global'): WorkBuddyCredential {
  return { accessToken: 'fixture-private-token', refreshToken: '', expiresAtMs: 1, domain: region === 'global' ? 'workbuddy.ai' : 'workbuddy.cn', uid: 'fixture-personal', source: 'desktop' }
}

describe('full official product media catalog', () => {
  it.each(['cn', 'global'] as const)('reads %s media declarations outside the chat-agent roster without inventing prices or model IDs', async region => {
    let requested: { url: string, headers: Headers, redirect: string | undefined } | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requested = { url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect }
      return Response.json(region === 'cn' ? { code: 0, data: product } : product)
    })
    const client = new WorkBuddyUpstreamClient({ resolveChatIdentity: async region => fallbackChatIdentity(region) })
    const c = credential(region)
    const models = await client.fetchMediaModels(c)
    expect(models).toEqual([
      { id: 'hunyuan-image-v3.0', tags: ['text-to-image'] },
      { id: 'kling-v3-t2v', tags: ['text-to-video'], videoGeneration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5 } },
      { id: 'kling-v3-i2v', tags: ['image-to-video'], videoGeneration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5, resolutions: ['720P'], defaultResolution: '720P' } },
    ])
    expect(requested?.url).toBe(`${region === 'cn' ? 'https://www.workbuddy.cn' : 'https://www.workbuddy.ai'}/v3/config`)
    expect(requested?.redirect).toBe('error')
    expect(requested?.headers.get('authorization')).toBe('Bearer fixture-private-token')
    expect(mediaRequestBody({ credential: c, model: models[1]! }, validateMediaRequest({ kind: 'video', mode: 'text', prompt: 'clouds' }))).toMatchObject({ model: 'kling-v3-t2v', seconds: 5, extra_parameters: { resolution: '1080P' } })
    expect(mediaRequestBody({ credential: c, model: models[2]! }, validateMediaRequest({ kind: 'video', mode: 'frame', prompt: '', firstFrame: 'https://media.example/frame.png' }))).toMatchObject({ model: 'kling-v3-i2v', seconds: 5, image_url: 'https://media.example/frame.png', extra_parameters: { resolution: '720P' } })
    expect(JSON.stringify(models)).not.toMatch(/untrusted-price|privateField|billing/)
  })
})
