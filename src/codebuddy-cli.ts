/** Bounded read-only CodeBuddy print process. No shell, fallback, resume or credential arguments. */
import { spawn, execFile } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'
import { ToolkitToolError, toolkitThrowIfCancelled } from './host-tools.ts'

export interface CodeBuddyConfiguration {
  nodeExecutable: string
  cliEntry: string
  workspace: string
  model: string
  effort: string
  timeoutMs: number
  maxTurns: number
}
export interface CodeBuddyRunRequest extends CodeBuddyConfiguration { prompt: string; signal: AbortSignal }
export interface CodeBuddyRunResult { status: 'completed'; text: string; turns: number }
const MAX_OUTPUT_BYTES = 1_048_576
const MAX_LINE_BYTES = 262_144
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function validateCodeBuddyConfiguration(configuration: CodeBuddyConfiguration): void {
  if (![configuration.nodeExecutable, configuration.cliEntry, configuration.workspace].every(value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0'))
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(configuration.model) || !EFFORTS.includes(configuration.effort)
    || !Number.isSafeInteger(configuration.timeoutMs) || configuration.timeoutMs < 100 || configuration.timeoutMs > 300_000
    || !Number.isSafeInteger(configuration.maxTurns) || configuration.maxTurns < 1 || configuration.maxTurns > 4) throw new ToolkitToolError('cli-configuration-invalid')
}

export function buildCodeBuddyArguments(request: CodeBuddyRunRequest): string[] {
  validateCodeBuddyConfiguration(request)
  if (typeof request.prompt !== 'string' || request.prompt.trim() === '' || request.prompt.length > 32_000) throw new ToolkitToolError('invalid-input')
  return [request.cliEntry, '--print', '--output-format', 'stream-json', '--verbose', '--tools', 'Read,Glob,Grep', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--max-turns', String(request.maxTurns), '--model', request.model, '--effort', request.effort, '--', request.prompt]
}

/** Only ordinary OS/home/certificate variables reach the child, never host provider keys. */
function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'userprofile', 'home', 'appdata', 'localappdata', 'programdata', 'lang', 'lc_all', 'node_extra_ca_certs', 'ssl_cert_file'])
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())))
}

/** Kill this process tree only. The settled close event remains the completion boundary. */
function terminateTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
    execFile(`${systemRoot}\\System32\\taskkill.exe`, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => {})
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* Already exited. */ } }
  }
}

/** Stream JSON contains only a bounded final result; debug/stderr text is never returned. */
export async function runCodeBuddy(request: CodeBuddyRunRequest): Promise<CodeBuddyRunResult> {
  const args = buildCodeBuddyArguments(request)
  toolkitThrowIfCancelled(request.signal)
  let workspace: string
  try {
    const [workspaceInfo, entry] = await Promise.all([stat(request.workspace), stat(request.cliEntry)])
    if (!workspaceInfo.isDirectory() || !entry.isFile()) throw new Error('invalid path')
    await access(request.nodeExecutable, constants.X_OK)
    workspace = await realpath(request.workspace)
  } catch { throw new ToolkitToolError('cli-unavailable') }
  toolkitThrowIfCancelled(request.signal)
  return await new Promise<CodeBuddyRunResult>((resolve, reject) => {
    const child = spawn(request.nodeExecutable, args, { cwd: workspace, shell: false, windowsHide: true, detached: process.platform !== 'win32', env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] })
    let bytes = 0; let pending = ''; let result: CodeBuddyRunResult | undefined; let failure: string | undefined; let completed = false
    const stop = (code: string): void => {
      if (failure !== undefined) return
      failure = code
      if (!completed) terminateTree(child.pid)
    }
    const timer = setTimeout(() => { stop('cli-timeout') }, request.timeoutMs)
    const onAbort = (): void => { stop('cancelled') }
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
    const parseLine = (line: string): void => {
      if (line.trim() === '') return
      let value: unknown
      try { value = JSON.parse(line) } catch { stop('cli-invalid-output'); return }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) { stop('cli-invalid-output'); return }
      const record = value as Record<string, unknown>
      if (record['type'] !== 'result') return
      if (Array.isArray(record['permission_denials']) && record['permission_denials'].length > 0) { stop('cli-permission-denied'); return }
      if (result !== undefined || record['is_error'] !== false || record['subtype'] !== 'success' || typeof record['result'] !== 'string') { stop('cli-failed'); return }
      const turns = record['num_turns']
      // Official num_turns counts active-agent history items, not the --max-turns budget.
      if (!Number.isSafeInteger(turns) || (turns as number) < 0 || (turns as number) > 100_000) { stop('cli-invalid-output'); return }
      result = { status: 'completed', text: record['result'], turns: turns as number }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_OUTPUT_BYTES) { stop('cli-output-limit'); return }
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) { stop('cli-output-limit'); return }
        parseLine(line)
      }
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES) stop('cli-output-limit')
    })
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_OUTPUT_BYTES) stop('cli-output-limit') })
    const finish = (code: number | null): void => {
      if (completed) return
      completed = true; clearTimeout(timer); request.signal.removeEventListener('abort', onAbort)
      if (pending.trim() !== '' && failure === undefined) parseLine(pending)
      if (failure !== undefined) reject(new ToolkitToolError(failure))
      else if (code !== 0 || result === undefined) reject(new ToolkitToolError('cli-failed'))
      else resolve(result)
    }
    child.on('error', () => { failure ??= 'cli-unavailable' })
    child.on('close', finish)
  })
}
