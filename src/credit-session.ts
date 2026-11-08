import type { Context } from '@deepseek-ai/cordis'
import type { WorkBuddyCreditLog } from './credit-log.ts'
import type {} from '@deepseek-ai/dsh-session'

export interface WorkBuddyCreditSessionRuntime {
  provider: string
  log: WorkBuddyCreditLog
}

/** Join completed host messages synchronously and retire joins with session lifetime. */
export function watchWorkBuddyCreditSessions(ctx: Context, runtimes: readonly WorkBuddyCreditSessionRuntime[]): void {
  let active = true
  const live = new Map<string, symbol>()
  ctx.inject(['sessions'], sessionsCtx => {
    if (!active) return
    const disposeCreated = sessionsCtx.on('session/created', session => {
      if (active) live.set(session.id, Symbol())
    })
    const disposeEvent = sessionsCtx.on('session/event', (session, event) => {
      if (!active || live.get(session.id) === undefined || event.type !== 'assistant/message' || event.data.interrupted === true) return
      const source = event.data.message.source
      const replay = source.replayState as { response?: { responseId?: unknown } } | undefined
      const responseId = replay?.response?.responseId
      if (typeof responseId !== 'string' || responseId.length === 0) return
      const runtime = runtimes.find(candidate => candidate.provider === source.provider)
      runtime?.log.associate(runtime.provider, responseId, session.id, event.data.message.id)
    })
    const disposeSession = sessionsCtx.on('session/disposed', session => {
      live.delete(session.id)
      for (const runtime of runtimes) runtime.log.removeSession(runtime.provider, session.id)
    })
    // Injected plugins can load after the controller has already created its
    // active Sessions; take a live snapshot as well as following future events.
    for (const session of sessionsCtx.sessions.list()) live.set(session.id, Symbol())
    return () => {
      live.clear()
      for (const runtime of runtimes) runtime.log.clear()
      disposeCreated()
      disposeEvent()
      disposeSession()
    }
  })
  ctx.effect(() => () => {
    active = false
    live.clear()
    for (const runtime of runtimes) runtime.log.clear()
  })
}
