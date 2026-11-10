import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const projectRequire = createRequire(join(root, 'package.json'))
const piRequire = createRequire(realpathSync(join(root, 'node_modules/@earendil-works/pi-ai/package.json')))

function resolvedVersion(context: NodeJS.Require, name: string) {
  const path = context.resolve(`${name}/package.json`)
  return JSON.parse(readFileSync(path, 'utf8')).version as string
}

describe('patched dependency resolution in the real installed provider graph', () => {
  it('publishes an explicit patched Zod floor rather than a consumer-ignored override', () => {
    expect(semver.gte(semver.minVersion(manifest.dependencies.zod)?.version ?? '0.0.0', '4.6.6')).toBe(true)
  })
  for (const [name, context] of [
    ['plugin', projectRequire],
    // pi-ai does not import or declare Zod itself. Check the SDKs it actually
    // loads, rather than an unrelated host Zod exposed by private hoisting.
    ['OpenAI SDK', createRequire(realpathSync(piRequire.resolve('openai')))],
    ['Anthropic SDK', createRequire(realpathSync(piRequire.resolve('@anthropic-ai/sdk')))],
  ] as const) {
    it(`${name} resolves a patched Zod instead of a stale nested/hoisted copy`, () => {
      expect(semver.gte(resolvedVersion(context, 'zod'), '4.6.6')).toBe(true)
    })
  }
  it('runs the patched Vitest mocker used by the development test runner', () => {
    const vitestRequire = createRequire(realpathSync(projectRequire.resolve('vitest/package.json')))
    expect(semver.gte(resolvedVersion(vitestRequire, '@vitest/mocker'), '4.1.12')).toBe(true)
  })
})
