import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextRescueService, createContextRescueTools } from '../src/context-rescue.ts'
import { registerContextRescueCommand, type ToolkitCommandInvocation } from '../src/context-rescue-command.ts'

const owned: string[] = []
afterEach(async () => { await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(process.cwd(), 'work/rescue-test-')); owned.push(directory)
  let revision = 'revision-a'; let idle = true; let sessionId = 'session-a'; let enabled = true
  const compact = vi.fn(async () => ({ summary: 'done' }))
  const service = new ContextRescueService({ enabled: () => enabled, exportDirectory: directory, readSnapshot: async () => ({ sessionId, revision, idle, events: [{ type: 'user/message', data: 'original' }], surfaceNodes: [0], estimatedTokens: 120 }), compact })
  return { service, compact, directory, change: () => { revision = 'revision-b' }, busy: () => { idle = false }, other: () => { sessionId = 'session-b' }, disable: () => { enabled = false } }
}
describe('explicit context rescue', () => {
  it('exports originals before preview and applies one idle matching revision only once', async () => {
    const f = await fixture(); const signal = new AbortController().signal
    const preview = await f.service.preview({}, signal)
    expect(JSON.parse(await readFile(join(f.directory, preview.exportFile), 'utf8')).events[0].data).toBe('original')
    expect(f.compact).not.toHaveBeenCalled()
    expect(await f.service.apply({}, preview.id, preview.revision, signal)).toEqual({ status: 'applied' })
    await expect(f.service.apply({}, preview.id, preview.revision, signal)).rejects.toThrow('preview-unavailable')
    expect(f.compact).toHaveBeenCalledTimes(1)
  })

  it('refuses stale, busy, cross-session and disabled application without compaction', async () => {
    for (const reason of ['change', 'busy', 'other', 'disable'] as const) {
      const f = await fixture(); const signal = new AbortController().signal; const preview = await f.service.preview({}, signal)
      f[reason]()
      await expect(f.service.apply({}, preview.id, preview.revision, signal)).rejects.toThrow()
      expect(f.compact).not.toHaveBeenCalled()
    }
  })

  it('does not expose an apply action to models and expires previews on disposal', async () => {
    const f = await fixture(); const signal = new AbortController().signal
    const tools = createContextRescueTools({ service: f.service })
    expect(tools.map(tool => tool.name)).toEqual(['workbuddy_context_preview'])
    await expect(tools[0]!.execute({ apply: true }, { agent: {}, signal })).rejects.toThrow('invalid-input')
    const preview = await f.service.preview({}, signal); f.service.dispose()
    await expect(f.service.apply({}, preview.id, preview.revision, signal)).rejects.toThrow('disposed')
  })

  it('registers a human-only explicit apply command and refuses malformed actions', async () => {
    const f = await fixture(); const signal = new AbortController().signal
    let handler: ((invocation: ToolkitCommandInvocation) => Promise<{ kind: 'success' | 'error'; text: string }>) | undefined
    const unregister = vi.fn()
    const dispose = registerContextRescueCommand({ register: definition => { expect(definition.name).toBe('workbuddy-rescue'); handler = definition.handler; return unregister } }, f.service)
    expect((await handler!({ agent: {}, signal, rawInput: 'apply $(secret) invalid' })).kind).toBe('error')
    const preview = await f.service.preview({}, signal)
    const result = await handler!({ agent: {}, signal, rawInput: `apply ${preview.id} ${preview.revision}` })
    expect(result.kind).toBe('success'); expect(f.compact).toHaveBeenCalledTimes(1)
    dispose(); expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('consumes previews on an uncertain compaction failure instead of applying twice', async () => {
    const f = await fixture(); const signal = new AbortController().signal
    const preview = await f.service.preview({}, signal)
    f.compact.mockRejectedValueOnce(new Error('private-host-diagnostic'))
    await expect(f.service.apply({}, preview.id, preview.revision, signal)).rejects.toThrow('rescue-apply-failed-inspect-session')
    await expect(f.service.apply({}, preview.id, preview.revision, signal)).rejects.toThrow('preview-unavailable')
    expect(f.compact).toHaveBeenCalledTimes(1)
  })
})
