import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { sanitizeWorkBuddyHistory } from '../src/history.ts'
import { createWorkBuddyAdapter } from '../src/adapter.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import type { WorkBuddyCredentialStore } from '../src/auth.ts'
import type { WorkBuddyShim } from '../src/shim.ts'

afterEach(() => vi.unstubAllGlobals())
function request(provider = 'workbuddy', source = 'other', model = 'model', replayState?: unknown): GenerateOptions {
  return { provider, model: 'model', messages: [
    { role: 'assistant', source: { provider: source, model, ...(replayState === undefined ? {} : { replayState }) }, content: [
      { type: 'reasoning', text: 'PRIVATE THINKING' }, { type: 'text', text: 'visible answer' },
      { type: 'tool-call', id: 'call_1', name: 'lookup', arguments: '{}' },
    ] },
    { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'tool result' }] },
    { role: 'user', content: [{ type: 'text', text: 'continue' }] },
  ] } as GenerateOptions
}
const replay = { response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'workbuddy', model: 'model', stopReason: 'toolUse' }, blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }, { type: 'text' }, { type: 'tool-call' }] }

describe('foreign thinking boundary', () => {
  it('drops only unreplayable reasoning, preserving text, tools, identity and input', () => {
    const input = request(); const before = JSON.stringify(input)
    const output = sanitizeWorkBuddyHistory(input)
    expect(JSON.stringify(output)).not.toContain('PRIVATE THINKING')
    expect(output.messages[0]?.content).toEqual(input.messages[0]?.content.slice(1))
    expect(output.messages[1]).toBe(input.messages[1])
    expect(JSON.stringify(input)).toBe(before)
    expect(output.provider).toBe('workbuddy')
  })
  it('preserves native same-model replay and drops foreign-model, malformed and absent replay', () => {
    const own = request('workbuddy', 'workbuddy', 'model', replay)
    expect(sanitizeWorkBuddyHistory(own)).toBe(own)
    for (const input of [request('workbuddy', 'workbuddy', 'different', replay), request('workbuddy', 'workbuddy'), request('workbuddy', 'workbuddy', 'model', { ...replay, blocks: [] })]) {
      expect(JSON.stringify(sanitizeWorkBuddyHistory(input))).not.toContain('PRIVATE THINKING')
    }
  })
  it.each(['workbuddy', 'workbuddy-ai'])('keeps foreign thoughts off the actual %s wire', async providerId => {
    const catalog = new WorkBuddyCatalog([{ id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 128, supportsImages: false }])
    const { adapter } = createWorkBuddyAdapter({ providerId, catalog, store: {} as WorkBuddyCredentialStore,
      shim: { baseUrl: () => 'http://127.0.0.1:1', token: () => 'test' } as WorkBuddyShim })
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, init?: RequestInit) => {
      body = String(init?.body)
      return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }))
    const call = await adapter.prepareCall(providerId, 'model')
    for await (const _ of call.stream(request(providerId))) {}
    expect(body).not.toContain('PRIVATE THINKING')
    expect(body).toContain('visible answer')
    expect(body).toContain('tool result')
    expect(body).toContain('lookup')
  })
  it.each(['workbuddy', 'workbuddy-ai'])('keeps native %s reasoning in its reasoning field', async providerId => {
    const catalog = new WorkBuddyCatalog([{ id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 128, supportsImages: false }])
    const { adapter } = createWorkBuddyAdapter({ providerId, catalog, store: {} as WorkBuddyCredentialStore,
      shim: { baseUrl: () => 'http://127.0.0.1:1', token: () => 'test' } as WorkBuddyShim })
    let body: { messages: Array<{ role: string; content?: string; reasoning_content?: string }> } | undefined
    vi.stubGlobal('fetch', vi.fn(async (_: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body
      return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }))
    const own = request(providerId, providerId, 'model', { ...replay, response: { ...replay.response, provider: providerId } })
    const call = await adapter.prepareCall(providerId, 'model')
    for await (const _ of call.stream(own)) {}
    const assistant = body?.messages.find(message => message.role === 'assistant')
    expect(assistant?.reasoning_content).toBe('PRIVATE THINKING')
    expect(assistant?.content).toBe('visible answer')
  })
})
