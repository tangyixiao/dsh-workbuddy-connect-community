import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../src/bin.ts'
import { shareableDoctorReport } from '../src/shareable-doctor.ts'

const FIXTURE_PARENT = join(process.cwd(), '.cache', 'task-5-tests')
const PATH_MARKER = 'C:\\Users\\PRIVATE-NICK\\AppData\\Roaming\\WorkBuddy\\auth.json'
const TOKEN_MARKER = 'eyJprivate.secret.payload'

async function capture(args: string[]): Promise<{ code: number, stdout: string, stderr: string }> {
  const out: string[] = []
  const err: string[] = []
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { out.push(String(chunk)); return true })
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { err.push(String(chunk)); return true })
  try {
    return { code: await run(args), stdout: out.join(''), stderr: err.join('') }
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
}

async function fixture(): Promise<string> {
  await mkdir(FIXTURE_PARENT, { recursive: true })
  const root = await mkdtemp(join(FIXTURE_PARENT, 'doctor-'))
  vi.stubEnv('DSH_HOME', join(root, 'dsh-home'))
  await mkdir(join(root, 'dsh-home'), { recursive: true })
  return root
}

function authDocument(domain: string): string {
  return JSON.stringify({
    auth: { accessToken: TOKEN_MARKER, refreshToken: 'refresh-secret-marker', expiresAt: Date.now() + 3_600_000, domain },
    account: { uid: 'uid-secret-marker', nickname: 'nickname-secret-marker' },
  })
}

describe('doctor --share', () => {
  let root: string | undefined

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it.each([
    ['workbuddy', 'WORKBUDDY_AUTH_FILE', 'copilot.tencent.com', 19],
    ['workbuddy-ai', 'WORKBUDDY_AI_AUTH_FILE', 'www.workbuddy.ai', 20],
  ])('emits allowlisted JSON for %s and excludes local and account details', async (provider, envName, domain, count) => {
    root = await fixture()
    const authPath = join(root, 'private-marker', 'desktop-auth.json')
    await mkdir(join(root, 'private-marker'), { recursive: true })
    await writeFile(authPath, authDocument(domain))
    vi.stubEnv(envName, authPath)
    // Current PID makes this a live synthetic heartbeat; no service is contacted.
    await writeFile(join(root, 'dsh-home', '.workbuddy-community-host-heartbeat.json'), JSON.stringify({
      version: 1,
      package: 'dsh-workbuddy-connect-community',
      pluginVersion: 'ignored-private-version',
      registeredAt: Date.now(),
      pid: process.pid,
    }))
    const { code, stdout } = await capture(['doctor', '--share', '--provider', provider])
    const report = JSON.parse(stdout) as Record<string, unknown>
    expect(code).toBe(0)
    expect(report).toMatchObject({ provider, signIn: 'signed-in', fallbackModels: count })
    expect(report['runtime']).toBe(process.version)
    expect(report['platform']).toBe(process.platform)
    expect(report['architecture']).toBe(process.arch)
    expect(report['readiness']).toMatchObject({ authentication: 'ready', host: 'running', liveInference: 'not-tested' })
    expect(JSON.stringify(report)).not.toContain(root)
    for (const marker of [PATH_MARKER, TOKEN_MARKER, 'refresh-secret-marker', 'uid-secret-marker', 'nickname-secret-marker', domain, 'ignored-private-version']) {
      expect(stdout).not.toContain(marker)
    }
    expect(report).not.toHaveProperty('hints')
    expect(report).not.toHaveProperty('decryptionNote')
    expect(report).not.toHaveProperty('ownAuthFile')
    expect(report).not.toHaveProperty('catalogUserAgent')
  })

  it('reports stale and missing heartbeat states without leaking its PID or timestamp', async () => {
    root = await fixture()
    vi.stubEnv('WORKBUDDY_AUTH_FILE', join(root, 'missing-auth'))
    await writeFile(join(root, 'dsh-home', '.workbuddy-community-host-heartbeat.json'), JSON.stringify({
      version: 1,
      package: 'dsh-workbuddy-connect-community',
      pluginVersion: '0.1.0-private',
      registeredAt: 1,
      pid: 2_000_000_000,
    }))
    const stale = await capture(['doctor', '--share'])
    const staleReport = JSON.parse(stale.stdout) as Record<string, unknown>
    expect(stale.code).toBe(1)
    expect(staleReport['hostHeartbeat']).toEqual({ present: true, processAlive: false })
    expect(staleReport['readiness']).toMatchObject({ authentication: 'needs-attention', host: 'stale', liveInference: 'not-tested' })
    expect(stale.stdout).not.toContain('2000000000')
    expect(stale.stdout).not.toContain('0.1.0-private')
    await rm(join(root, 'dsh-home', '.workbuddy-community-host-heartbeat.json'))
    const absent = await capture(['doctor', '--share'])
    expect(JSON.parse(absent.stdout)['readiness']).toMatchObject({ host: 'not-started' })
  })

  it.each(['status', 'logout'])('rejects %s --share before action', async action => {
    const { code, stdout, stderr } = await capture([action, '--share'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('invalid options')
  })
})

describe('shareable doctor allowlist', () => {
  it('drops malformed reason codes and unknown inputs', () => {
    const report = shareableDoctorReport({
      version: '0.1.0',
      runtime: 'v22.19.0',
      platform: 'win32',
      architecture: 'x64',
      provider: 'workbuddy',
      desktopAuthFile: { present: true, format: 'encrypted' },
      signIn: 'signed-out',
      reasonCode: `unknown-${PATH_MARKER}`,
      hostHeartbeat: { present: false, processAlive: false },
      fallbackModels: 40,
      appVersionSource: PATH_MARKER,
      // Deliberately beyond the TypeScript contract to prove the projection ignores extras.
      path: PATH_MARKER,
      error: TOKEN_MARKER,
    } as unknown as Parameters<typeof shareableDoctorReport>[0] & Record<string, unknown>)
    expect(report).not.toHaveProperty('reasonCode')
    expect(report).not.toHaveProperty('appVersionSource')
    expect(JSON.stringify(report)).not.toContain(PATH_MARKER)
    expect(JSON.stringify(report)).not.toContain(TOKEN_MARKER)
  })

  it.each([
    ['Windows-shaped', 'win32'],
    ['macOS-shaped', 'darwin'],
    ['Linux-shaped', 'linux'],
  ])('accepts %s platform fixture as simulated evidence only', (label, platform) => {
    const report = shareableDoctorReport({
      version: '0.1.0', runtime: 'v22.19.0', platform, architecture: 'x64', provider: 'workbuddy',
      desktopAuthFile: { present: false, format: 'absent' }, signIn: 'signed-out', reasonCode: 'electron-binary-unavailable',
      hostHeartbeat: { present: false, processAlive: false }, fallbackModels: 19,
    })
    expect(report['platform']).toBe(platform)
    expect(report['reasonCode']).toBe('electron-binary-unavailable')
    expect((report['readiness'] as Record<string, unknown>)['liveInference']).toBe('not-tested')
    expect(label).toContain('shaped')
  })
})
