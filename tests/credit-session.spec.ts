import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyCreditLog } from '../src/credit-log.ts'
import { watchWorkBuddyCreditSessions } from '../src/credit-session.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined })

function session(id: string): Session { return { id } as unknown as Session }

function assistantEvent(responseId: string, messageId: string): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: messageId,
        source: { kind: 'model', provider: 'workbuddy', model: 'model', replayState: { response: { responseId } } },
      },
      stream: [],
    },
  } as unknown as SessionEvent<'assistant/message'>
}

describe('WorkBuddy credit host session lifecycle', () => {
  it('does not restore disposed or shutdown joins from late host events', async () => {
    ctx = new Context()
    const log = new WorkBuddyCreditLog()
    const runtime = { provider: 'workbuddy', log }
    const existing = session('session-existing')
    await ctx.plugin(async pluginCtx => {
      pluginCtx.provide('sessions', { list: () => [existing] } as never)
      watchWorkBuddyCreditSessions(pluginCtx, [runtime])
    })

    // The controller already owned this Session before the plugin injected.
    log.observe('response-existing', 2, 'uid-a:')
    ctx.emit('session/event', existing, assistantEvent('response-existing', 'message-existing'))
    expect(log.read('workbuddy', 'uid-a:', existing.id).credits).toEqual({ 'message-existing': 2 })
    ctx.emit('session/disposed', existing)
    expect(log.read('workbuddy', 'uid-a:', existing.id).credits).toEqual({})

    const disposed = session('session-disposed')
    ctx.emit('session/created', disposed)
    log.observe('response-disposed', 3, 'uid-a:')
    ctx.emit('session/event', disposed, assistantEvent('response-disposed', 'message-disposed'))
    expect(log.read('workbuddy', 'uid-a:', disposed.id).credits).toEqual({ 'message-disposed': 3 })
    ctx.emit('session/disposed', disposed)
    ctx.emit('session/event', disposed, assistantEvent('response-disposed', 'message-late'))
    expect(log.read('workbuddy', 'uid-a:', disposed.id).credits).toEqual({})

    const shuttingDown = session('session-shutdown')
    ctx.emit('session/created', shuttingDown)
    log.observe('response-shutdown', 4, 'uid-a:')
    ctx.emit('session/event', shuttingDown, assistantEvent('response-shutdown', 'message-shutdown'))
    expect(log.read('workbuddy', 'uid-a:', shuttingDown.id).credits).toEqual({ 'message-shutdown': 4 })
    await ctx.fiber.dispose()
    expect(log.size).toBe(0)
    ctx.emit('session/event', shuttingDown, assistantEvent('response-shutdown', 'message-too-late'))
    expect(log.size).toBe(0)
  })
})
