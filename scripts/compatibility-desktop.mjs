import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [executable, resources, archive, expectedVersion] = process.argv.slice(2)
assert(executable && resources && archive, 'Usage: node scripts/compatibility-desktop.mjs <Electron executable> <resources directory> <Community tarball> [DSH version]')

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const home = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'community-dsh-desktop-'))
const profile = join(home, 'profiles', 'desktop')
const runtime = resolve(resources, 'app.asar', 'dsh')
const primary = resolve(resources, 'runtime', 'primary-runtime')
const nodeBin = resolve(resources, 'runtime', 'bin')
const pnpm = [join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'), resolve(resources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')].find(existsSync)
const env = {
  ...process.env,
  DSH_HOME: home,
  ELECTRON_RUN_AS_NODE: '1',
  DSH_DESKTOP_NODE_EXECUTABLE: resolve(executable),
  PATH: `${nodeBin}${delimiter}${process.env.PATH ?? ''}`,
  WORKBUDDY_AUTH_FILE: join(home, 'no-workbuddy-sign-in.json'),
  WORKBUDDY_AI_AUTH_FILE: join(home, 'no-workbuddy-ai-sign-in.json'),
  npm_config_registry: 'https://registry.npmjs.org/',
  CI: 'true',
}
const packageDir = join(runtime, 'node_modules', '@deepseek-ai')
const endpoints = ['/plugins/dsh-workbuddy-connect/status', '/plugins/dsh-workbuddy-connect/ai/status']
const report = {
  pluginVersion: manifest.version, platform: process.platform, arch: process.arch,
  channel: process.env.DSH_COMPATIBILITY_DESKTOP_CHANNEL,
  desktopArtifactSha512: process.env.DSH_COMPATIBILITY_DESKTOP_SHA512,
  checks: {},
}

function runElectron(args, cwd = home) {
  const result = spawnSync(resolve(executable), ['--expose-internals', ...args], {
    env, cwd, encoding: 'utf8', timeout: 240_000, windowsHide: true,
  })
  assert.equal(result.status, 0, `Packaged Electron command failed: ${result.error ?? result.stderr.slice(-1600)}`)
  return result.stdout.trim()
}

async function checkHost(enabled) {
  const child = spawn(resolve(executable), [
    '--expose-internals', join(packageDir, 'dsh-desktop-host', 'lib', 'index.js'), runtime, profile,
    primary, 'runtime', pnpm, nodeBin,
  ], { env, cwd: profile, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const closed = new Promise(resolve => child.once('close', resolve))
  const startup = new Promise((resolve, reject) => {
    child.on('message', event => {
      if (event.type === 'ready') resolve(event.url)
      if (event.type === 'fatal') reject(new Error('Packaged Desktop Host reported a startup failure'))
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Packaged Desktop Host exited before ready (${code})`)))
  })
  try {
    const ready = await Promise.race([startup, delay(60_000, undefined, { ref: false })])
    assert(ready, 'Packaged Desktop Host did not become ready')
    const url = new URL(ready)
    assert(url.protocol === 'http:' && url.hostname === '127.0.0.1', 'Expected a loopback Desktop Host URL')
    const auth = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    await auth.body?.cancel()
    assert(cookie, 'Desktop Host owner session unavailable')
    for (const endpoint of endpoints) {
      const response = await fetch(new URL(endpoint, url), { headers: { cookie, origin: url.origin }, signal: AbortSignal.timeout(15_000) })
      assert.equal(response.status, enabled ? 200 : 404, endpoint)
      if (enabled) assert.equal((await response.json()).status, 'signed-out', endpoint)
      else await response.body?.cancel()
    }
    if (enabled) {
      const heartbeat = JSON.parse(await readFile(join(home, '.workbuddy-community-host-heartbeat.json'), 'utf8'))
      assert.equal(heartbeat.pid, child.pid, 'Provider heartbeat belongs to the current Desktop Host')
      assert.equal(heartbeat.pluginVersion, manifest.version)
    }
  } finally {
    if (child.connected) child.send({ type: 'shutdown' }, () => {})
    if (await Promise.race([closed.then(() => false), delay(12_000, true, { ref: false })])) {
      child.kill()
      await closed
    }
  }
}

try {
  assert(pnpm, 'Bundled Desktop pnpm was not found')
  const appBoot = join(packageDir, 'dsh-app-boot', 'lib', 'index.js')
  const desktop = JSON.parse(runElectron(['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    const [boot, officialBundles, profile, descriptor] = process.argv.slice(1);
    const { initProfile, ...exports } = await import(pathToFileURL(boot));
    const { PROFILE_TEMPLATES } = exports.PROFILE_TEMPLATES
      ? exports : await import(pathToFileURL(officialBundles));
    initProfile(profile, PROFILE_TEMPLATES.web.bundles);
    const runtime = JSON.parse(readFileSync(descriptor, 'utf8'));
    console.log(JSON.stringify({ hostVersion: runtime.release.version, electron: process.versions.electron }));
  `, appBoot, join(packageDir, 'dsh-official-bundles', 'lib', 'index.js'), profile, join(runtime, 'desktop-runtime.json')]))
  assert(desktop.electron, 'Expected the packaged Electron runtime')
  if (expectedVersion) assert.equal(desktop.hostVersion, expectedVersion, 'Packaged host version')
  Object.assign(report, desktop)
  report.archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  runElectron([pnpm, 'add', resolve(archive), '--ignore-scripts', '--save-exact'], profile)
  const profileManifestPath = join(profile, 'package.json')
  const profileManifest = JSON.parse(await readFile(profileManifestPath, 'utf8'))
  const select = async enabled => {
    const bundles = profileManifest.dsh.profile.bundles.filter(name => name !== manifest.name)
    profileManifest.dsh.profile.bundles = enabled ? [...bundles, manifest.name] : bundles
    await writeFile(profileManifestPath, JSON.stringify(profileManifest, null, 2) + '\n')
  }
  await select(true)
  await checkHost(true)
  report.checks.packagedDesktopHost = 'passed'
  await select(false)
  await checkHost(false)
  report.checks.disableAndRestart = 'passed'
} catch (error) {
  report.error = error.message
  process.exitCode = 1
} finally {
  await rm(home, { recursive: true, force: true })
  const output = JSON.stringify(report, null, 2) + '\n'
  if (process.env.DSH_COMPATIBILITY_REPORT) await writeFile(process.env.DSH_COMPATIBILITY_REPORT, output)
  console.log(output.trim())
}
