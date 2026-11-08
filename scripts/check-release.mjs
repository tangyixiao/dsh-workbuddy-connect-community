import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Optional package-directory argument supports disposable malformed fixtures.
const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const id = 'dsh-workbuddy-connect-community'
const hostRange = '0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.5 || 0.2.2-rc.1'
const hostPeers = ['attachment', 'client-connection', 'home-paths', 'host-webserver', 'llm', 'llm-pi-ai', 'settings']
const files = ['lib', 'cordis.patch.yml', 'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']
const runtime = ['lib/index.js', 'lib/index.d.ts', 'lib/bin.js', 'lib/bin.d.ts', 'lib/client.js']
const read = path => readFileSync(join(root, path), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const pkg = JSON.parse(read('package.json'))
  assert(pkg.name === id, 'package identity must be Community')
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package version must be a stable release')
  assert(pkg.engines?.dsh === hostRange, 'host range changed; qualify compatibility separately')
  for (const peer of hostPeers) {
    assert(pkg.peerDependencies?.[`@deepseek-ai/dsh-${peer}`] === hostRange, `DSH peer range missing or changed: ${peer}`)
  }
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert(version === '0.2.2-rc.1', `DSH development version changed: ${name}`)
  }
  assert(pkg.main === 'lib/index.js' && pkg.types === 'lib/index.d.ts', 'runtime entry points changed')
  assert(pkg.bin?.[id] === 'lib/bin.js' && Object.keys(pkg.bin).length === 1, 'CLI identity or entry changed')
  assert(pkg.exports?.['.']?.default === './lib/index.js' && pkg.exports?.['.']?.types === './lib/index.d.ts', 'host exports changed')
  assert(pkg.exports?.['./client'] === './lib/client.js', 'client export changed')
  assert(pkg.exports?.['./cordis.patch.yml'] === './cordis.patch.yml' && pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'bundle patch entry changed')
  assert(pkg.dsh?.client?.platform === 'web', 'client platform changed')
  assert(pkg.publishConfig?.registry === 'https://registry.npmjs.org', 'publish registry must be the official npm registry')
  assert(Array.isArray(pkg.files) && JSON.stringify([...pkg.files].sort()) === JSON.stringify([...files].sort()), 'files whitelist changed')
  assert(/^\s+name: dsh-workbuddy-connect-community\s*$/m.test(read('cordis.patch.yml')), 'patch identity must register Community')
  assert(/^\s+- id: llm-workbuddy\s*$/m.test(read('cordis.patch.yml')), 'patch registration must use llm-workbuddy')
  for (const path of [...runtime, ...files.filter(path => path !== 'lib')]) {
    assert(existsSync(join(root, path)) && statSync(join(root, path)).isFile(), `missing runtime file or release document: ${path}`)
  }
  const client = read('lib/client.js')
  assert(/window\.__ModuleLoader__\.load\(\{\s*id:\s*"dsh-workbuddy-connect-community"/.test(client), 'client bundle identity changed')
  assert(/\bname\s*=\s*"dsh-workbuddy-connect-community-client"/.test(client)
    && /\bBUNDLE_NAME\s*=\s*"dsh-workbuddy-connect-community"/.test(client), 'client contribution identity changed')
  const built = readdirSync(join(root, 'lib')).map(path => `lib/${path}`)
  assert(built.every(path => /\.(?:js|d\.ts)$/.test(path) || path === 'lib/.npmignore'), 'unexpected built runtime file')
  let serverVersion = false
  let clientVersion = false
  for (const path of built.filter(path => path.endsWith('.js'))) {
    const source = read(path)
    for (const match of source.matchAll(/\bWORKBUDDY_CONNECT_VERSION\s*=\s*"([^"]+)"/g)) {
      assert(match[1] === pkg.version, `built version differs from package.json: ${path}`)
      if (path === 'lib/client.js') clientVersion = true
      else serverVersion = true
    }
    for (const match of source.matchAll(/\bfrom\s*["'](\.\/[^"]+\.js)["']/g)) {
      assert(existsSync(resolve(root, dirname(path), match[1])), `missing runtime file imported by ${path}: ${match[1]}`)
    }
  }
  assert(serverVersion && clientVersion, 'built version must be present in host and client bundles')

  // Ignore lifecycle scripts to avoid prepack recursion. This inspects local
  // files only; --offline makes that boundary explicit even under npm config.
  const packArgs = ['pack', '--dry-run', '--ignore-scripts', '--offline', '--json']
  // Windows runs npm.cmd through a fixed command string, without shell arguments.
  const packed = spawnSync(process.platform === 'win32' ? 'npm pack --dry-run --ignore-scripts --offline --json' : 'npm', process.platform === 'win32' ? [] : packArgs, {
    cwd: root, encoding: 'utf8', shell: process.platform === 'win32', timeout: 30_000,
  })
  assert(packed.status === 0, `npm pack inspection failed: ${packed.stderr || packed.error || packed.status}`)
  const paths = new Set(JSON.parse(packed.stdout)[0].files.map(file => file.path))
  const expected = ['package.json', ...built.filter(path => path !== 'lib/.npmignore'), ...files.filter(path => path !== 'lib')]
  assert(expected.every(path => paths.has(path)), `pack coverage missing: ${expected.filter(path => !paths.has(path)).join(', ')}`)
  assert([...paths].every(path => expected.includes(path)), `pack contains unexpected files: ${[...paths].filter(path => !expected.includes(path)).join(', ')}`)
  console.log(`Release checks passed: ${id}@${pkg.version}, ${paths.size} packed files`)
} catch (error) {
  console.error(`Release check failed: ${error.message}`)
  process.exitCode = 1
}
