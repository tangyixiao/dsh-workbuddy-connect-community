import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const [discovery, target, channel, pluginArchive, cachedArtifact] = process.argv.slice(2)
assert(discovery && target && channel && pluginArchive, 'Usage: node scripts/compatibility-desktop-artifact.mjs <discovery.json> <target> <channel> <Community tarball> [cached official artifact]')
const { desktop } = JSON.parse(await readFile(discovery, 'utf8'))
const row = desktop.find(release => release.target === target && release.channel === channel)
assert.equal(row?.status, 'artifact-available', `Desktop artifact missing for ${target} ${channel}`)
const windows = target === 'win-x64'
const nativeTarget = `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform}-${process.arch}`
assert.equal(target, nativeTarget, 'Desktop target must match the runner OS and architecture')
const url = new URL(row.artifact)
assert(url.origin === 'https://download.deepseek.com' && url.pathname.startsWith(`/dsh-desk/bin/${target}/`), 'Expected the official Desktop release path')
assert(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 650_000_000, 'Desktop artifact size is out of bounds')
const scratch = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'community-desktop-artifact-'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 300_000, windowsHide: true, ...options })
  assert.equal(result.status, 0, `${command} failed: ${result.error ?? result.status}`)
}

try {
  const artifact = cachedArtifact ?? join(scratch, windows ? 'desktop.exe' : 'desktop.zip')
  if (!cachedArtifact) {
    const reply = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(240_000) })
    assert(reply.ok && reply.body && Number(reply.headers.get('content-length')) === row.bytes, `Unexpected Desktop download response (${reply.status})`)
    await pipeline(Readable.fromWeb(reply.body), createWriteStream(artifact, { flags: 'wx' }))
  }
  assert.equal((await stat(artifact)).size, row.bytes, 'Desktop artifact size changed')
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(artifact)) hash.update(chunk)
  assert.equal(hash.digest('base64'), row.sha512, 'Desktop artifact SHA-512 differs from the official feed')
  const unpacked = join(scratch, 'app')
  await mkdir(unpacked)
  let executable
  let resources
  if (windows) {
    const programFiles = process.env.ProgramFiles ?? 'C:/Program Files'
    const system7z = join(programFiles, '7-Zip', '7z.exe')
    const sevenZip = existsSync(system7z) ? system7z : '7z.exe'
    run(sevenZip, ['e', '-y', `-o${scratch}`, artifact, '$PLUGINSDIR\\app-64.7z'])
    run(sevenZip, ['x', '-y', `-o${unpacked}`, join(scratch, 'app-64.7z')])
    executable = join(unpacked, 'DeepSeek Harness.exe')
    resources = join(unpacked, 'resources')
  } else {
    run('ditto', ['-x', '-k', artifact, unpacked])
    const apps = (await readdir(unpacked)).filter(name => name.endsWith('.app'))
    assert.equal(apps.length, 1, 'Expected one application bundle in the Desktop archive')
    const app = join(unpacked, apps[0])
    const contents = join(app, 'Contents')
    run('codesign', ['--verify', '--deep', '--strict', app])
    executable = join(contents, 'MacOS', 'DeepSeek Harness')
    resources = join(contents, 'Resources')
  }
  const smoke = fileURLToPath(new URL('compatibility-desktop.mjs', import.meta.url))
  run(process.execPath, [smoke, executable, resources, pluginArchive, row.version], {
    env: { ...process.env, DSH_COMPATIBILITY_DESKTOP_CHANNEL: channel, DSH_COMPATIBILITY_DESKTOP_SHA512: row.sha512 },
  })
} finally {
  await rm(scratch, { recursive: true, force: true })
}
