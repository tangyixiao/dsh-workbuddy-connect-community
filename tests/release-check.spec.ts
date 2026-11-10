import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const project = resolve(import.meta.dirname, '..')
let root: string
let manifest: any

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'workbuddy-release-'))
  manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
  for (const path of ['package.json', ...manifest.files]) {
    cpSync(join(project, path), join(root, path), { recursive: true })
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function check() {
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  return spawnSync(process.execPath, [join(project, 'scripts/check-release.mjs'), root], { encoding: 'utf8' })
}

it('accepts a coherent built package and its offline pack list', () => {
  const result = check()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Release checks passed')
}, 20_000)

it.each([
  ['package identity', (pkg: any) => { pkg.name = 'another-plugin' }, 'package identity'],
  ['stale version', (pkg: any) => { pkg.version = '9.9.9' }, 'built version'],
  ['widened host range', (pkg: any) => { pkg.engines.dsh = '>=0.2.1' }, 'host range'],
  ['missing DSH peer', (pkg: any) => { delete pkg.peerDependencies['@deepseek-ai/dsh-settings'] }, 'DSH peer'],
  ['widened DSH peer', (pkg: any) => { pkg.peerDependencies['@deepseek-ai/dsh-llm'] = '*' }, 'DSH peer'],
  ['missing client export', (pkg: any) => { delete pkg.exports['./client'] }, 'client export'],
  ['missing logo export', (pkg: any) => { delete pkg.exports['./icon'] }, 'logo entry'],
  ['unsafe files whitelist', (pkg: any) => { pkg.files.push('src') }, 'files whitelist'],
] as const)('rejects %s', (_name, mutate, diagnostic) => {
  mutate(manifest)
  const result = check()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(diagnostic)
})

it.each([
  ['patch identity', 'cordis.patch.yml', 'name: another-plugin\n', 'patch identity'],
  ['patch registration', 'cordis.patch.yml', '- insert:\n    - id: another-provider\n      name: dsh-workbuddy-connect-community\n', 'patch registration'],
  ['client bundle identity', 'lib/client.js', 'window.__ModuleLoader__.load({id: "another-plugin"});', 'client bundle identity'],
] as const)('rejects %s', (_name, path, content, diagnostic) => {
  writeFileSync(join(root, path), content)
  const result = check()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(diagnostic)
})

it('rejects a missing runtime entry', () => {
  rmSync(join(root, 'lib/bin.js'))
  const result = check()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('runtime file')
})

it('rejects a missing imported runtime chunk', () => {
  writeFileSync(join(root, 'lib/bin.js'), 'import { run } from "./missing-chunk.js";\n')
  const result = check()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('missing runtime file imported')
})

it('rejects an ignored runtime file that exists locally but would not ship', () => {
  writeFileSync(join(root, 'lib/.npmignore'), 'client.js\n')
  const result = check()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('pack coverage')
}, 20_000)

it('rejects a banner that exists locally but is excluded from the published package', () => {
  writeFileSync(join(root, 'docs/.npmignore'), 'assets/banner-en.svg\n')
  const result = check()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('pack coverage')
}, 20_000)
