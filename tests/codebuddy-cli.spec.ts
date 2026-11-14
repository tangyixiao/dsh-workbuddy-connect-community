import { join, resolve } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCodeBuddyArguments, runCodeBuddy, type CodeBuddyRunRequest } from '../src/codebuddy-cli.ts'
import { createCodeBuddyTools } from '../src/codebuddy-tools.ts'

const configuration = { nodeExecutable: process.execPath, cliEntry: resolve('work/fixture-cli.cjs'), workspace: process.cwd(), model: 'hy4-preview', effort: 'high', timeoutMs: 1000, maxTurns: 1 }
const request = (prompt = 'Review this code'): CodeBuddyRunRequest => ({ ...configuration, prompt, signal: new AbortController().signal })
const owned: string[] = []
afterEach(async () => { await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fakeCli(source: string): Promise<CodeBuddyRunRequest> {
  const directory = await mkdtemp(join(process.cwd(), 'work/cli-test-')); owned.push(directory)
  const entry = join(directory, 'fake.cjs'); await writeFile(entry, source)
  return { ...request(), cliEntry: entry, workspace: directory, timeoutMs: 3000 }
}

describe('bounded CodeBuddy bridge', () => {
  it('uses strict empty MCP, allows only read-only tools, and never autoapproves or emits bypass/fallback/resume flags', () => {
    const args = buildCodeBuddyArguments(request('$(secret); `unsafe`'))
    expect(args).toContain('$(secret); `unsafe`')
    expect(args).toEqual(expect.arrayContaining(['--tools', 'Read,Glob,Grep', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--max-turns', '1', '--settings', '{"disableAllHooks":true}']))
    expect(args.join(' ')).not.toMatch(/allowedTools|skip-permissions|bypassPermissions|fallback-model|--resume|--continue/u)
  })

  it('refuses unsafe configuration before creating a child', async () => {
    for (const changes of [{ model: '--bad' }, { effort: 'ultra' }, { timeoutMs: 0 }, { maxTurns: 100 }, { workspace: 'relative' }, { cliEntry: 'relative' }]) {
      await expect(runCodeBuddy({ ...request(), ...changes })).rejects.toThrow('cli-configuration-invalid')
    }
  })

  it('does no execution when disabled or approval is absent; rechecks after approval', async () => {
    const run = vi.fn(async () => ({ status: 'completed' as const, text: 'ok', turns: 1 }))
    const exec = { agent: {}, signal: new AbortController().signal }
    let enabled = false
    const deps = { enabled: () => enabled, configuration: () => configuration, run }
    await expect(createCodeBuddyTools(deps)[0]!.execute({ prompt: 'review' }, exec)).rejects.toThrow('feature-disabled')
    enabled = true
    await expect(createCodeBuddyTools(deps)[0]!.execute({ prompt: 'review' }, exec)).rejects.toThrow('approval-unavailable')
    const tools = createCodeBuddyTools({ ...deps, approval: { request: async () => { enabled = false; return 'allowed-once' } } })
    await expect(tools[0]!.execute({ prompt: 'review' }, exec)).rejects.toThrow('feature-disabled')
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses model-provided execution paths and changed configuration while awaiting approval', async () => {
    const run = vi.fn()
    const exec = { agent: {}, signal: new AbortController().signal }
    let model = 'hy4-preview'
    const tools = createCodeBuddyTools({ enabled: () => true, configuration: () => ({ ...configuration, model }), approval: { request: async () => { model = 'hy3'; return 'allowed-once' } }, run })
    await expect(tools[0]!.execute({ prompt: 'review', cwd: 'C:/private' }, exec)).rejects.toThrow('invalid-input')
    await expect(tools[0]!.execute({ prompt: 'review' }, exec)).rejects.toThrow('configuration-changed')
    expect(run).not.toHaveBeenCalled()
  })

  it('parses a bounded final stream record without returning debug/stderr text', async () => {
    const result = await runCodeBuddy(await fakeCli(`console.error('private-diagnostic'); console.log(JSON.stringify({type:'system',key:'private-diagnostic'})); process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'reviewed',num_turns:1}));`))
    expect(result).toEqual({ status: 'completed', text: 'reviewed', turns: 1 })
  })

  it('rejects malformed, unsuccessful and duplicate finals without leaking child diagnostics', async () => {
    for (const source of [`console.log('not JSON private-token');`, `console.error('secret-token'); process.exit(7)`, `console.log(JSON.stringify({type:'result',subtype:'error',result:'private-token',num_turns:1}));`, `for(let i=0;i<2;i++)console.log(JSON.stringify({type:'result',subtype:'success',result:'x',num_turns:1}));`]) {
      await expect(runCodeBuddy(await fakeCli(source))).rejects.toThrow(/^workbuddy: cli-(invalid-output|failed)$/u)
    }
  })

  it('kills and awaits a task-owned child on timeout, cancellation and output overflow', async () => {
    const waiting = await fakeCli('setInterval(()=>{},1000)')
    await expect(runCodeBuddy({ ...waiting, timeoutMs: 200 })).rejects.toThrow('cli-timeout')
    const controller = new AbortController()
    const pending = runCodeBuddy({ ...waiting, signal: controller.signal })
    setTimeout(() => { controller.abort() }, 200)
    await expect(pending).rejects.toThrow('cancelled')
    await expect(runCodeBuddy(await fakeCli(`process.stdout.write('x'.repeat(300000)); setInterval(()=>{},1000)`))).rejects.toThrow('cli-output-limit')
  }, 15_000)

  it('returns a fixed denial when ordinary CLI permissions refuse a read', async () => {
    await expect(runCodeBuddy(await fakeCli(`console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'private path',num_turns:1,permission_denials:[{private:'path'}]}))`))).rejects.toThrow('cli-permission-denied')
  })

  it('qualifies each provider registration and approves its exact tool identity', async () => {
    const approval = { request: vi.fn(async (_request: unknown) => 'allowed-once' as const) }
    const tools = createCodeBuddyTools({ prefix: 'workbuddy_ai', enabled: () => true, configuration: () => configuration, approval, run: async () => ({ status: 'completed', text: 'done', turns: 1 }) })
    expect(tools[0]!.name).toBe('workbuddy_ai_codebuddy_review')
    await tools[0]!.execute({ prompt: 'review' }, { agent: {}, signal: new AbortController().signal })
    expect(approval.request.mock.calls[0]![0]).toMatchObject({ toolName: 'workbuddy_ai_codebuddy_review' })
  })
})
