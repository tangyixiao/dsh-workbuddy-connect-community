import { ContextRescueService } from './context-rescue.ts'
import { ToolkitToolError } from './host-tools.ts'

export interface ToolkitCommandInvocation { agent: unknown; rawInput: string; signal: AbortSignal }
export interface ToolkitCommandRegistry {
  register(definition: { name: string; description: string; handler: (invocation: ToolkitCommandInvocation) => Promise<{ kind: 'success' | 'error'; text: string }> }): () => void
}

/** Human command consent is explicit. Host approval.request cannot audit outside an open turn. */
export function registerContextRescueCommand(registry: ToolkitCommandRegistry, service: ContextRescueService): () => void {
  return registry.register({
    name: 'workbuddy-rescue',
    description: 'Preview/export context, then explicitly compact the same idle session revision',
    handler: async invocation => {
      const operands = invocation.rawInput.trim().split(/\s+/u)
      try {
        if (operands.length === 1 && operands[0] === 'preview') {
          const preview = await service.preview(invocation.agent, invocation.signal)
          const target = preview.summaryTarget === undefined ? '' : `\nSummary target: ${preview.summaryTarget.provider}/${preview.summaryTarget.model}. Applying may consume this account's credits.`
          return { kind: 'success', text: `${JSON.stringify(preview)}${target}\nInspect the retained original export. To authorize host compaction of this revision: /workbuddy-rescue apply ${preview.id} ${preview.revision}` }
        }
        if (operands.length === 3 && operands[0] === 'apply' && /^[a-f0-9]{32}$/u.test(operands[1]!) && /^[A-Za-z0-9._:-]{1,512}$/u.test(operands[2]!)) {
          const result = await service.apply(invocation.agent, operands[1]!, operands[2]!, invocation.signal)
          return { kind: 'success', text: result.status === 'unchanged' ? 'No safely compactable history. Original export retained.' : 'Host compaction completed. Original export retained. No conversation request was resent.' }
        }
        return { kind: 'error', text: 'Usage: /workbuddy-rescue preview | /workbuddy-rescue apply <preview-id> <revision>' }
      } catch (error) {
        return { kind: 'error', text: error instanceof ToolkitToolError ? error.message : 'workbuddy: rescue-unavailable' }
      }
    },
  })
}
