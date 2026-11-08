export interface WorkBuddySessionCredits {
  sessionId: string
  credits: Record<string, number>
}

/** Reads only the credit fields from upstream SSE; the forwarded byte stream is separate. */
export class WorkBuddyCreditSseObserver {
  private static readonly MAX_BUFFER_CHARS = 1_048_576
  private readonly decoder = new TextDecoder()
  private pending = ''
  private observed: { responseId: string; credit: number } | undefined
  private complete = false
  private overflowed = false

  push(bytes: Uint8Array): void {
    if (this.overflowed) return
    this.pending += this.decoder.decode(bytes, { stream: true })
    if (this.pending.length > WorkBuddyCreditSseObserver.MAX_BUFFER_CHARS) {
      this.overflowed = true
      this.pending = ''
      return
    }
    this.consumeLines(false)
  }

  finish(): { responseId: string; credit: number } | undefined {
    this.pending += this.decoder.decode()
    this.consumeLines(true)
    return this.complete && !this.overflowed && this.observed !== undefined
      ? this.observed
      : undefined
  }

  private consumeLines(final: boolean): void {
    const lines = this.pending.split(/\r?\n/u)
    this.pending = final ? '' : lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trimStart()
      if (payload === '') continue
      if (payload === '[DONE]') { this.complete = true; continue }
      try {
        const value: unknown = JSON.parse(payload)
        if (typeof value !== 'object' || value === null) continue
        const event = value as { id?: unknown; usage?: { credit?: unknown }; choices?: Array<{ finish_reason?: unknown }> }
        const credit = event.usage?.credit
        if (typeof event.id === 'string' && event.id.length > 0 && typeof credit === 'number' && Number.isFinite(credit) && credit >= 0) {
          this.observed = { responseId: event.id, credit }
        }
        if (event.choices?.some(choice => typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0)) this.complete = true
      } catch { /* incomplete or non-JSON SSE data is ignored */ }
    }
  }
}

interface CreditEntry {
  credit?: number
  provider?: string
  account?: string
  sessionId?: string
  messageId?: string
}

/** Short-lived, bounded join between upstream response ids and host messages. */
export class WorkBuddyCreditLog {
  private readonly entries = new Map<string, CreditEntry>()

  constructor(private readonly limit = 512) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('credit log limit must be a positive safe integer')
  }

  get size(): number { return this.entries.size }

  observe(responseId: string, credit: number): boolean {
    if (!validId(responseId) || !Number.isFinite(credit) || credit < 0) return false
    const entry = this.getOrCreate(responseId)
    entry.credit = credit
    return entry.provider !== undefined
  }

  associate(provider: string, account: string, responseId: string, sessionId: string, messageId: string): boolean {
    if (![provider, account, responseId, sessionId, messageId].every(validId)) return false
    const entry = this.getOrCreate(responseId)
    entry.provider = provider
    entry.account = account
    entry.sessionId = sessionId
    entry.messageId = messageId
    return entry.credit !== undefined
  }

  read(provider: string, account: string, sessionId: string): WorkBuddySessionCredits {
    const credits: Record<string, number> = Object.create(null) as Record<string, number>
    for (const entry of this.entries.values()) {
      if (entry.provider === provider && entry.account === account && entry.sessionId === sessionId && entry.messageId !== undefined && entry.credit !== undefined) {
        credits[entry.messageId] = entry.credit
      }
    }
    return { sessionId, credits }
  }

  clear(): void { this.entries.clear() }

  removeSession(provider: string, sessionId: string): void {
    for (const [responseId, entry] of this.entries) {
      if (entry.provider === provider && entry.sessionId === sessionId) this.entries.delete(responseId)
    }
  }

  private getOrCreate(responseId: string): CreditEntry {
    let entry = this.entries.get(responseId)
    if (entry === undefined) entry = {}
    else this.entries.delete(responseId)
    this.entries.set(responseId, entry)
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string)
    return entry
  }
}

function validId(value: string): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 512 }
