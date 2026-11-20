import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const [hostVersion, cli, archive] = process.argv.slice(2)
assert(hostVersion && cli && archive, 'Usage: node scripts/compatibility-web.mjs <DSH version> <CLI bin.js> <Community tarball>')

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const home = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'community-dsh-web-'))
const env = {
  ...process.env,
  DSH_HOME: home,
  WORKBUDDY_AUTH_FILE: join(home, 'no-workbuddy-sign-in.json'),
  WORKBUDDY_AI_AUTH_FILE: join(home, 'no-workbuddy-ai-sign-in.json'),
  npm_config_registry: 'https://registry.npmjs.org/',
  CI: 'true',
}
const endpoints = ['/plugins/dsh-workbuddy-connect/status', '/plugins/dsh-workbuddy-connect/ai/status']
const report = { hostVersion, pluginVersion: manifest.version, platform: process.platform, checks: {} }

async function checkBrowser(base, cookie) {
  const { chromium } = await import(pathToFileURL(resolve(process.env.DSH_COMPATIBILITY_PLAYWRIGHT)))
  const browser = await chromium.launch({ executablePath: process.env.DSH_COMPATIBILITY_CHROMIUM })
  report.browserVersion = browser.version()
  let step = 'open the workspace'
  try {
    const page = await browser.newPage({ locale: 'en-US' })
    await page.context().addCookies(cookie.split('; ').map(pair => {
      const separator = pair.indexOf('=')
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: base }
    }))
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    step = 'open the Plugins page'
    const plugins = page.getByRole('button', { name: /^(Plugins|插件)$/ })
    const acknowledge = page.getByRole('button', { name: /^(Continue|继续)$/ })
    await page.addLocatorHandler(acknowledge, () => acknowledge.click())
    await plugins.click({ timeout: 30_000 })
    step = 'open the Community configuration'
    const item = page.locator(`[data-plugin-package="${manifest.name}"]`)
    await item.getByRole('button', { name: /WorkBuddy[- ]Connect[- ]Community/i }).click({ timeout: 15_000 })
    step = 'render both WorkBuddy cards'
    const cards = page.locator(`[data-plugin-detail="${manifest.name}"] [data-plugin-config]`)
    await cards.getByRole('button', { name: /DSH WorkBuddy Connect[ （(]/ }).waitFor({ timeout: 15_000 })
    await cards.getByRole('button', { name: /DSH WorkBuddy AI Connect[ （(]/ }).waitFor({ timeout: 15_000 })
  } catch {
    throw new Error(`Chromium could not ${step}`)
  } finally {
    await browser.close()
  }
}

function run(args) {
  const result = spawnSync(process.execPath, ['--expose-internals', resolve(cli), ...args], {
    env, cwd: home, encoding: 'utf8', timeout: 240_000, windowsHide: true,
  })
  assert.equal(result.status, 0, `${args[0]} failed: ${result.error ?? result.stderr.slice(-2000)}`)
  return result.stdout.trim()
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function withHost(check) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [
    '--expose-internals', resolve(cli), 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], { env, cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  let spawnError
  child.once('error', error => { spawnError = error })
  const closed = new Promise(resolve => child.once('close', resolve))
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { log = (log + data).slice(-48_000) })
  }
  try {
    let token
    for (let attempt = 0; attempt < 180; attempt++) {
      if (spawnError) throw spawnError
      assert(child.exitCode === null, `Web exited before readiness (${child.exitCode})`)
      token = log.split(`${base}/?token=`)[1]?.match(/^[\w.%~-]+/)?.[0]
      if (token) break
      await delay(300)
    }
    assert(token, 'Web host did not announce a loopback owner URL')
    const request = (path, headers) => fetch(base + path, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    })
    const auth = await request(`/?token=${encodeURIComponent(decodeURIComponent(token))}`)
    const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    await auth.body?.cancel()
    assert(cookie, `Web owner session unavailable (${auth.status})`)
    await check(path => request(path, { cookie, origin: base }), child.pid, base, cookie)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await closed
  }
}

try {
  assert.equal(run(['--version']), hostVersion, 'Resolved DSH CLI version')
  report.archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex')
  run(['plugin', '--profile', 'web', 'add', resolve(archive), '--ignore-scripts', '--save-exact'])
  const profile = join(home, 'profiles', 'web')
  const installed = JSON.parse(await readFile(join(profile, 'node_modules', manifest.name, 'package.json'), 'utf8'))
  assert.equal(installed.version, manifest.version, 'Installed Community package version')
  report.checks.install = 'passed'

  await withHost(async (request, pid, base, cookie) => {
    for (const endpoint of endpoints) {
      const response = await request(endpoint)
      assert.equal(response.status, 200, endpoint)
      const status = await response.json()
      assert.equal(status.status, 'signed-out', `${endpoint} must use the isolated signed-out fixture`)
    }
    report.checks.signedOutRoutes = 'passed'
    const heartbeat = JSON.parse(await readFile(join(home, '.workbuddy-community-host-heartbeat.json'), 'utf8'))
    assert.equal(heartbeat.pid, pid, 'Provider heartbeat belongs to the current host')
    assert.equal(heartbeat.pluginVersion, manifest.version, 'Running Community bundle version')
    report.checks.hostHeartbeat = 'passed'
    const shell = await request('/')
    assert.equal(shell.status, 200, 'Web client entry')
    assert.match(shell.headers.get('content-type') ?? '', /text\/html/, 'Web client entry is HTML')
    await shell.body?.cancel()
    report.checks.clientEntry = 'passed'
    if (process.env.DSH_COMPATIBILITY_PLAYWRIGHT) {
      await checkBrowser(base, cookie)
      report.checks.browserCards = 'passed'
    }
  })
  run(['plugin', '--profile', 'web', 'remove', manifest.name, '--config.ignore-scripts=true'])
  await withHost(async request => {
    for (const endpoint of endpoints) {
      const response = await request(endpoint)
      assert.equal(response.status, 404, `Removed route: ${endpoint}`)
      await response.body?.cancel()
    }
  })
  report.checks.removeAndRestart = 'passed'
} catch (error) {
  report.error = error.message
  process.exitCode = 1
} finally {
  await rm(home, { recursive: true, force: true })
  const output = JSON.stringify(report, null, 2)
  if (process.env.DSH_COMPATIBILITY_REPORT) await writeFile(process.env.DSH_COMPATIBILITY_REPORT, output + '\n')
  console.log(output)
}
