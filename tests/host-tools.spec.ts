import { describe, expect, it, vi } from 'vitest'
import { requireToolkitApproval, registerToolkitTools } from '../src/host-tools.ts'

describe('toolkit host boundary', () => {
  it('fails closed for absent, declined and broken approval without exposing diagnostics', async () => {
    const exec = { agent: {}, signal: new AbortController().signal }
    await expect(requireToolkitApproval(undefined, exec, 'tool', 'reason')).rejects.toThrow('approval-unavailable')
    for (const outcome of ['rejected', 'cancelled', 'unavailable'] as const) {
      await expect(requireToolkitApproval({ request: async () => outcome }, exec, 'tool', 'reason')).rejects.toThrow(`approval-${outcome}`)
    }
    await expect(requireToolkitApproval({ request: async () => { throw new Error('secret-token') } }, exec, 'tool', 'reason')).rejects.toThrow('approval-unavailable')
    const request = vi.fn(async () => 'allowed-once' as const)
    await requireToolkitApproval({ request }, exec, 'tool', 'reason')
    expect(request).toHaveBeenCalledWith({ ...exec, toolName: 'tool', reason: 'reason' })
  })

  it('cancellation after a grant still prevents dispatch', async () => {
    const controller = new AbortController()
    await expect(requireToolkitApproval({ request: async () => { controller.abort(); return 'allowed-once' } }, { agent: {}, signal: controller.signal }, 'tool', 'reason')).rejects.toThrow('cancelled')
  })

  it('rolls back a partial registration and disposes once in reverse order', () => {
    const calls: string[] = []
    const definition = (name: string) => ({ name, description: name, parameters: { type: 'object' }, output: { schema: {}, render: () => [] }, execute: async () => ({}) })
    expect(() => registerToolkitTools({ register: d => { if (d.name === 'b') throw new Error('conflict'); return () => { calls.push(d.name) } } }, [definition('a'), definition('b')])).toThrow('conflict')
    expect(calls).toEqual(['a'])
    const dispose = registerToolkitTools({ register: d => () => { calls.push(d.name) } }, [definition('a'), definition('b')])
    dispose(); dispose()
    expect(calls).toEqual(['a', 'b', 'a'])
  })
})
