import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mirror pi-ai v2 replay validation before trusting reasoning as native history. */
function nativeReplay(message: GenerateOptions['messages'][number], provider: string, model: string): boolean {
  if (message.role !== 'assistant' || message.source.provider !== provider || message.source.model !== model) return false
  const state: unknown = message.source.replayState
  if (!record(state) || !record(state['response']) || !Array.isArray(state['blocks'])) return false
  const response = state['response']
  if (response['kind'] !== 'pi-ai' || response['version'] !== 2 || response['api'] !== 'openai-completions'
    || response['provider'] !== provider || response['model'] !== model
    || !['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(response['stopReason']))) return false
  for (const key of ['responseId', 'responseModel', 'providerThinkingLevel']) if (response[key] !== undefined && typeof response[key] !== 'string') return false
  if (state['blocks'].length !== message.content.length) return false
  return state['blocks'].every((block: unknown, i: number) => {
    if (!record(block) || block['type'] !== message.content[i]?.type || !['text', 'reasoning', 'tool-call'].includes(String(block['type']))) return false
    for (const key of ['textSignature', 'thinkingSignature', 'thoughtSignature', 'namespace']) if (block[key] !== undefined && typeof block[key] !== 'string') return false
    return block['redacted'] === undefined || typeof block['redacted'] === 'boolean'
  })
}

/**
 * Foreign/degraded thinking becomes answer text in pi-ai. Remove only those
 * blocks before conversion, keeping durable history and routing untouched.
 */
export function sanitizeWorkBuddyHistory(options: GenerateOptions): GenerateOptions {
  let changed = false
  const messages = options.messages.flatMap(message => {
    if (message.role !== 'assistant' || !message.content.some(block => block.type === 'reasoning') || nativeReplay(message, options.provider, options.model)) return [message]
    changed = true
    const content = message.content.filter(block => block.type !== 'reasoning')
    if (content.length === 0) return []
    // Removing a block invalidates the old metadata indices. Native replay is
    // already unavailable here; preserve identity and use neutral text/tools.
    const { replayState: _replay, ...source } = message.source
    return [{ ...message, source, content }]
  })
  return changed ? { ...options, messages } : options
}
