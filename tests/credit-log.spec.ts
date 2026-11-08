import { describe, expect, it } from 'vitest'
import { WorkBuddyCreditLog, WorkBuddyCreditSseObserver } from '../src/credit-log.ts'

describe('WorkBuddyCreditLog', () => {
  it('joins observed credits to exact response, provider, account, session, and message identities', () => {
    const log = new WorkBuddyCreditLog(3)
    log.observe('r1', 0, 'account-a')
    expect(log.associate('workbuddy', 'r1', 'session-a', 'message-a')).toBe(true)
    expect(log.read('workbuddy', 'account-a', 'session-a')).toEqual({ sessionId: 'session-a', credits: { 'message-a': 0 } })
    expect(log.read('workbuddy-ai', 'account-a', 'session-a')).toEqual({ sessionId: 'session-a', credits: {} })
    expect(log.read('workbuddy', 'account-b', 'session-a')).toEqual({ sessionId: 'session-a', credits: {} })
    expect(log.read('workbuddy', 'account-a', 'session-b')).toEqual({ sessionId: 'session-b', credits: {} })
  })

  it('accepts either arrival order and keeps the latest valid usage value', () => {
    const log = new WorkBuddyCreditLog()
    expect(log.associate('workbuddy', 'r2', 's', 'm')).toBe(false)
    log.observe('r2', 2, 'account-a')
    log.observe('r2', 3, 'account-a')
    expect(log.read('workbuddy', 'account-a', 's').credits).toEqual({ m: 3 })
  })

  it('keeps concurrent response joins independent when completions arrive in reverse order', () => {
    const log = new WorkBuddyCreditLog()
    log.associate('workbuddy', 'first', 'session-a', 'message-first')
    log.associate('workbuddy', 'second', 'session-b', 'message-second')
    log.observe('second', 2, 'account-a')
    log.observe('first', 1, 'account-a')
    expect(log.read('workbuddy', 'account-a', 'session-a').credits).toEqual({ 'message-first': 1 })
    expect(log.read('workbuddy', 'account-a', 'session-b').credits).toEqual({ 'message-second': 2 })
  })

  it('decodes split UTF-8 frames and retains the last valid credit observation', () => {
    const observer = new WorkBuddyCreditSseObserver()
    const frame = new TextEncoder().encode('data: {"id":"resp-😀","usage":{"credit":1}}\n\ndata: {"id":"resp-😀","usage":{"credit":0}}\n\ndata: [DONE]\n\n')
    const split = frame.indexOf(0xf0) + 2
    observer.push(frame.slice(0, split))
    observer.push(frame.slice(split))
    expect(observer.finish()).toEqual({ responseId: 'resp-😀', credit: 0 })
  })

  it('ignores missing ids, invalid credits, and unrelated events', () => {
    const observer = new WorkBuddyCreditSseObserver()
    observer.push(new TextEncoder().encode([
      'data: {"id":"r","usage":{"credit":-1}}',
      '',
      'data: {"id":"r","usage":{"credit":"1"}}',
      '',
    ].join('\n')))
    expect(observer.finish()).toBeUndefined()
  })

  it('requires the response id and usage credit to share a frame and requires completion', () => {
    const split = new WorkBuddyCreditSseObserver()
    split.push(new TextEncoder().encode('data: {"id":"r"}\n\ndata: {"usage":{"credit":4}}\n\n'))
    expect(split.finish()).toBeUndefined()

    const truncated = new WorkBuddyCreditSseObserver()
    truncated.push(new TextEncoder().encode('data: {"id":"r","usage":{"credit":4}}\n\n'))
    expect(truncated.finish()).toBeUndefined()
  })

  it('drops observations when an unterminated SSE frame exceeds the parser bound', () => {
    const observer = new WorkBuddyCreditSseObserver()
    observer.push(new Uint8Array(1_048_577).fill(65))
    expect(observer.finish()).toBeUndefined()
  })

  it('bounds retained responses and clears account-sensitive entries', () => {
    const log = new WorkBuddyCreditLog(2)
    for (let i = 1; i <= 3; i++) {
      log.observe(`r${i}`, i, 'account-a')
      log.associate('workbuddy', `r${i}`, 's', `m${i}`)
    }
    expect(log.size).toBe(2)
    expect(log.read('workbuddy', 'account-a', 's').credits).toEqual({ m2: 2, m3: 3 })
    log.clear()
    expect(log.size).toBe(0)
    expect(log.read('workbuddy', 'account-a', 's').credits).toEqual({})
  })

  it('drops a disposed session from the in-memory join', () => {
    const log = new WorkBuddyCreditLog()
    log.observe('r', 1, 'account-a')
    log.associate('workbuddy', 'r', 's', 'm')
    log.removeSession('workbuddy', 's')
    expect(log.read('workbuddy', 'account-a', 's').credits).toEqual({})
  })

  it('rejects a captured account observation after reconciliation clears the account epoch', () => {
    const log = new WorkBuddyCreditLog()
    const requestEpoch = log.epoch
    log.clear() // account B was adopted while account A's completion was pending
    expect(log.observe('response-a', 7, 'uid-a:', requestEpoch)).toBe(false)
    expect(log.read('workbuddy', 'uid-b:', 'session-b').credits).toEqual({})
    expect(log.size).toBe(0)
  })

  it('does not attach interrupted or unobserved responses', () => {
    const log = new WorkBuddyCreditLog()
    log.associate('workbuddy', 'missing', 's', 'm')
    expect(log.read('workbuddy', 'account-a', 's').credits).toEqual({})
    log.observe('interrupted', 8, 'account-a')
    expect(log.read('workbuddy', 'account-a', 's').credits).toEqual({})
  })
})
