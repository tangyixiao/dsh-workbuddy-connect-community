import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyMessageCredit } from '../src/client/WorkBuddyMessageCredit.tsx'

let renderer: ReactTestRenderer | undefined

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function props(sessionId: string, messageId: string): React.ComponentProps<typeof WorkBuddyMessageCredit> {
  return { sessionId, messageId, provider: 'workbuddy', t: (key: string) => key === 'observedCreditTitle' ? 'observed' : '{credit} credits' } as React.ComponentProps<typeof WorkBuddyMessageCredit>
}

describe('WorkBuddyMessageCredit', () => {
  it('keeps unknown absent and renders an observed zero', async () => {
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId: 's1', credits: { m1: 0 } }), { status: 200 })))
    await act(async () => { renderer = create(React.createElement(WorkBuddyMessageCredit, props('s1', 'unknown'))); await Promise.resolve() })
    expect(renderer!.toJSON()).toBeNull()
    await act(async () => { renderer!.update(React.createElement(WorkBuddyMessageCredit, props('s1', 'm1'))); await Promise.resolve() })
    expect(JSON.stringify(renderer!.toJSON())).toContain('0 credits')
  })

  it('refreshes later data, switches sessions, and clears the timer on teardown', async () => {
    vi.useFakeTimers()
    const clearInterval = vi.fn()
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval })
    let credit = 1
    let failing = false
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const sessionId = new URL(String(input), 'http://local').searchParams.get('sessionId')!
      if (failing) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ sessionId, credits: { m1: credit } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)
    await act(async () => { renderer = create(React.createElement(WorkBuddyMessageCredit, props('s1', 'm1'))); await Promise.resolve() })
    expect(JSON.stringify(renderer!.toJSON())).toContain('1 credits')
    credit = 2
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('2 credits')
    failing = true
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(renderer!.toJSON()).toBeNull()
    failing = false
    await act(async () => { renderer!.update(React.createElement(WorkBuddyMessageCredit, props('s2', 'm1'))); await Promise.resolve() })
    expect(fetchSpy.mock.calls.some(call => new URL(String(call[0]), 'http://local').searchParams.get('sessionId') === 's2')).toBe(true)
    act(() => renderer!.unmount())
    renderer = undefined
    expect(clearInterval).toHaveBeenCalled()
  })

  it('aborts the session request when its last message unmounts', async () => {
    vi.useFakeTimers()
    const clearInterval = vi.fn()
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval })
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }))
    await act(async () => { renderer = create(React.createElement(WorkBuddyMessageCredit, props('s1', 'm1'))); await Promise.resolve() })
    act(() => renderer!.unmount())
    renderer = undefined
    expect(signal?.aborted).toBe(true)
  })
})
