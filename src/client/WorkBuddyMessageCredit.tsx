import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkBuddySessionCredits } from '../credit-log.ts'

interface Injected { sessionId: string; provider: string }

type Props = PropsRuntime<'conversation.chat.assistant-actions'> & PropsLocale<'settings.workbuddy'> & Injected

interface SessionFeed { listeners: Set<() => void>; snapshot: WorkBuddySessionCredits | undefined; timer: number; inflight: boolean; controller?: AbortController }
const feeds = new Map<string, SessionFeed>()

function subscribe(provider: string, sessionId: string, listener: () => void): () => void {
  const key = `${provider}\0${sessionId}`
  let feed = feeds.get(key)
  if (feed === undefined) {
    const listeners = new Set<() => void>()
    const refresh = async () => {
      const current = feeds.get(key)
      if (current === undefined || current.inflight) return
      current.inflight = true
      const controller = new AbortController()
      current.controller = controller
      try {
        const response = await fetch(`/plugins/dsh-workbuddy-connect/${provider === 'workbuddy-ai' ? 'ai/' : ''}credits?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('credit observation unavailable')
        const snapshot = await response.json() as WorkBuddySessionCredits
        if (snapshot.sessionId !== sessionId || typeof snapshot.credits !== 'object' || snapshot.credits === null) throw new Error('invalid credit observation')
        const credits: Record<string, number> = Object.create(null) as Record<string, number>
        for (const [messageId, credit] of Object.entries(snapshot.credits)) {
          if (Number.isFinite(credit) && credit >= 0) credits[messageId] = credit
        }
        const active = feeds.get(key)
        if (active === current) active.snapshot = { sessionId, credits }
      } catch {
        if (!controller.signal.aborted) {
          const active = feeds.get(key)
          if (active === current) active.snapshot = undefined
        }
      } finally {
        const active = feeds.get(key)
        if (active === current) {
          active.inflight = false
          delete active.controller
          for (const notify of listeners) notify()
        }
      }
    }
    feed = { listeners, snapshot: undefined, timer: 0, inflight: false }
    feeds.set(key, feed)
    void refresh()
    feed.timer = window.setInterval(() => { void refresh() }, 2000)
  }
  feed.listeners.add(listener)
  return () => {
    const current = feeds.get(key)
    if (current === undefined) return
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      window.clearInterval(current.timer)
      current.controller?.abort()
      feeds.delete(key)
    }
  }
}

/** Shows only the credit observed for this exact completed assistant message. */
export function WorkBuddyMessageCredit({ sessionId, messageId, provider, t }: Props) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    return subscribe(provider, sessionId, () => setRevision(value => value + 1))
  }, [sessionId, messageId, provider])

  void revision
  const credit = feeds.get(`${provider}\0${sessionId}`)?.snapshot?.credits?.[messageId]
  if (credit === undefined) return null
  return <span className="wb-message-credit" title={t('observedCreditTitle')}>{t('observedCredit').replace('{credit}', String(credit))}</span>
}
