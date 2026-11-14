import { buildCodeBuddyArguments, runCodeBuddy, type CodeBuddyConfiguration, type CodeBuddyRunRequest, type CodeBuddyRunResult } from './codebuddy-cli.ts'
import { requireToolkitApproval, toolkitJsonOutput, toolkitObject, ToolkitToolError, type ToolkitApproval, type ToolkitToolDefinition } from './host-tools.ts'

export interface CodeBuddyToolDependencies {
  enabled: () => boolean | Promise<boolean>
  configuration: () => CodeBuddyConfiguration | Promise<CodeBuddyConfiguration>
  approval?: ToolkitApproval
  run?: (request: CodeBuddyRunRequest) => Promise<CodeBuddyRunResult>
  /** Abort on plugin disposal/account invalidation; do not abandon child processes. */
  lifetime?: AbortSignal
  /** Provider-qualified registration; never inferred by parsing model/user input. */
  prefix?: string
}

export function createCodeBuddyTools(deps: CodeBuddyToolDependencies): ToolkitToolDefinition[] {
  const prefix = deps.prefix ?? 'workbuddy'
  if (!/^workbuddy(?:_(?:cn|ai))?$/u.test(prefix)) throw new ToolkitToolError('tool-prefix-invalid')
  const name = `${prefix}_codebuddy_review`
  return [{
    name,
    description: 'Ask the explicitly configured CodeBuddy model for a bounded workspace review. Only Read/Glob/Grep are available; ordinary CLI permissions still apply. MCP, hooks and modifying tools are disabled. Requires separate host approval for every call and may consume WorkBuddy credit. No filesystem sandbox is implied.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 32_000 } }, required: ['prompt'], additionalProperties: false },
    output: toolkitJsonOutput(),
    execute: async (args, exec) => {
      const input = toolkitObject(args, ['prompt'], ['prompt'])
      if (typeof input['prompt'] !== 'string' || input['prompt'].trim() === '' || input['prompt'].length > 32_000) throw new ToolkitToolError('invalid-input')
      if (!await deps.enabled()) throw new ToolkitToolError('feature-disabled')
      const configuration = { ...await deps.configuration() }
      const signal = deps.lifetime === undefined ? exec.signal : AbortSignal.any([exec.signal, deps.lifetime])
      const request = { ...configuration, prompt: input['prompt'], signal }
      buildCodeBuddyArguments(request)
      await requireToolkitApproval(deps.approval, { ...exec, signal }, name, `Run a read-only CodeBuddy review in ${configuration.workspace} using ${configuration.model} (${configuration.effort}), at most ${configuration.maxTurns} turns and ${configuration.timeoutMs} ms. Only Read/Glob/Grep; ordinary CLI permissions apply. May consume CodeBuddy account credit.`)
      if (!await deps.enabled()) throw new ToolkitToolError('feature-disabled')
      if (JSON.stringify(await deps.configuration()) !== JSON.stringify(configuration)) throw new ToolkitToolError('configuration-changed')
      return await (deps.run ?? runCodeBuddy)(request)
    },
  }]
}
