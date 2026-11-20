import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

const upstream = 'https://api.github.com/repos/deepseek-ai/deepseek-harness'
const download = 'https://download.deepseek.com'
const npm = 'https://registry.npmjs.org/@deepseek-ai%2fdsh'
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const declared = manifest.engines.dsh.split(' || ')
const targets = ['win-x64', 'mac-arm64', 'mac-x64']
const channels = ['stable', 'nightly']
const runners = { 'win-x64': 'windows-latest', 'mac-arm64': 'macos-latest', 'mac-x64': 'macos-15-intel' }
const githubHeaders = process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}

function request(url, headers) {
  return fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
}

async function json(url, headers) {
  const response = await request(url, headers)
  assert(response.ok, `${url}: HTTP ${response.status}`)
  return response.json()
}

async function desktopFeed(target, channel) {
  const feed = `${download}/dsh-desk/feeds/${target}/${channel}${target.startsWith('mac') ? '-mac' : ''}.yml`
  const response = await request(feed)
  if (response.status === 404) return { target, channel, feed, status: 'unavailable' }
  assert(response.ok, `${feed}: HTTP ${response.status}`)
  const document = await response.text()
  // The updater emits both plain and line-wrapped top-level YAML scalars.
  const readScalar = name => document.match(new RegExp(`^${name}:[ \\t]*(?:[>|]-?\\r?\\n[ \\t]+)?['"]?([^\\s'"]+)`, 'm'))?.[1]
  const version = readScalar('version')
  const path = readScalar('path')
  const sha512 = readScalar('sha512')
  assert(versionPattern.test(version ?? '') && path && /^[A-Za-z0-9+/]{86}==$/.test(sha512 ?? ''), `Invalid feed: ${feed}`)
  const artifact = new URL(path, feed)
  assert(artifact.origin === download && artifact.pathname.startsWith(`/dsh-desk/bin/${target}/`), `Unexpected desktop download origin or target: ${feed}`)
  const metadata = await fetch(artifact, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(20_000) })
  const bytes = Number(metadata.headers.get('content-length'))
  assert(metadata.ok && Number.isSafeInteger(bytes) && bytes > 0, `Desktop artifact unavailable: ${artifact} (HTTP ${metadata.status})`)
  return { target, channel, feed, version, artifact: artifact.href, sha512, bytes, status: 'artifact-available' }
}

const [registry, tags, releases, desktop] = await Promise.all([
  json(npm, { accept: 'application/vnd.npm.install-v1+json' }),
  json(`${upstream}/tags?per_page=12`, githubHeaders),
  json(`${upstream}/releases?per_page=12`, githubHeaders),
  Promise.all(targets.flatMap(target => channels.map(channel => desktopFeed(target, channel)))),
])

const github = {
  tags: tags.map(tag => tag.name),
  releases: releases.map(release => release.tag_name),
}
const latestRelease = github.releases.find(tag => tag.startsWith('dsh-v') && versionPattern.test(tag.slice(5)))
const upstreamCandidates = [registry['dist-tags'].latest, registry['dist-tags'].next, latestRelease?.slice(5)].filter(Boolean)
const manual = process.env.DSH_WEB_VERSION
const scheduled = process.env.GITHUB_EVENT_NAME === 'schedule'
const selected = manual ? [manual] : scheduled ? upstreamCandidates : declared
assert(selected.every(version => versionPattern.test(version)), 'Expected exact DSH versions')
const missingWeb = [...new Set(selected)].filter(version => !registry.versions[version])
assert(!manual || !missingWeb.length, `DSH ${manual} is unavailable on npm`)
const web = [...new Set(selected)].filter(version => registry.versions[version]).map(version => {
  const integrity = registry.versions[version].dist.integrity
  assert(integrity, `Missing npm integrity for ${version}`)
  return { version, digest: createHash('sha256').update(integrity).digest('hex').slice(0, 20) }
})
assert(web.length > 0 && (scheduled || missingWeb.length === 0), `Missing Web packages: ${missingWeb.join(', ')}`)
const desktopJobs = desktop.filter(row => row.version && declared.includes(row.version))
  .filter(row => scheduled || process.env.DSH_DESKTOP_ALL_CHANNELS === 'true' || row.channel === 'stable')
  .map(({ target, channel, version, sha512 }) => ({
    target, channel, version, runner: runners[target],
    digest: createHash('sha256').update(sha512).digest('hex').slice(0, 20),
  }))
const report = { github, npmTags: registry['dist-tags'], web, missingWeb, desktop }

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `web=${JSON.stringify(web)}\ndesktop=${JSON.stringify(desktopJobs)}\n`)
}
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    '## DSH versions', '',
    `Web test targets: ${web.map(row => row.version).join(', ')}`,
    `GitHub Release: ${github.releases[0] ?? 'unavailable'}`,
    `GitHub Tag: ${github.tags[0] ?? 'unavailable'}`,
    ...(missingWeb.length ? [`Awaiting npm packages: ${missingWeb.join(', ')}`] : []), '',
    '| Desktop target | Channel | Artifact discovery |', '| --- | --- | --- |',
    ...desktop.map(row => `| ${row.target} | ${row.channel} | ${row.version ? `[${row.version}](${row.artifact})${declared.includes(row.version) ? '' : ' (outside the declared host range)'}` : 'unavailable'} |`), '',
  ].join('\n'))
}
if (process.env.DSH_COMPATIBILITY_REPORT) {
  await writeFile(process.env.DSH_COMPATIBILITY_REPORT, JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
