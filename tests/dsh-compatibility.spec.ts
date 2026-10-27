import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import semver from 'semver'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const hostRanges = Object.entries(manifest.peerDependencies as Record<string, string>)
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

describe('DSH host compatibility', () => {
  it.each(['0.2.1-rc.2', '0.2.1-rc.3'])('accepts %s in the engine and every host peer', (version) => {
    expect(semver.satisfies(version, manifest.engines.dsh)).toBe(true)
    expect(hostRanges.length).toBeGreaterThan(0)
    for (const [name, range] of hostRanges) {
      expect(semver.satisfies(version, range), name).toBe(true)
    }
  })

  it.each(['0.1.9', '0.2.1-rc.1', '0.2.1-rc.4', '0.2.1', '0.2.2-rc.1', '0.2.2', '0.3.0-rc.1', '0.3.0', '1.0.0'])('rejects unqualified host %s', (version) => {
    expect(semver.satisfies(version, manifest.engines.dsh)).toBe(false)
    for (const [name, range] of hostRanges) {
      expect(semver.satisfies(version, range), name).toBe(false)
    }
  })
})
