/**
 * The pi-ai resolution guard (issue #92).
 *
 * These cover the message contract rather than the resolution mechanics: the
 * resolver is a one-line `import.meta.resolve` whose behaviour belongs to Node.
 * What matters here is that a mismatched copy says something actionable, and
 * that a correct install stays quiet.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  piAiVersionWarning,
  REQUIRED_PI_AI_VERSION,
  resolvedPiAiVersion,
} from '../src/pi-ai-guard.ts'

describe('pi-ai resolution guard', () => {
  it('uses the exact runtime pin that the manifest installs and the integration suite exercises', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const installedPin = manifest.dependencies['@earendil-works/pi-ai']
    expect(installedPin).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(manifest.devDependencies['@earendil-works/pi-ai']).toBe(installedPin)
    expect(REQUIRED_PI_AI_VERSION).toBe(installedPin)
    expect(piAiVersionWarning(installedPin)).toBeUndefined()
  })

  it('still warns when an older plugin generation is resolved after an upgrade', () => {
    expect(piAiVersionWarning('1.3.0')).toContain(REQUIRED_PI_AI_VERSION)
  })

  it('stays silent for the version this plugin is built for', () => {
    expect(piAiVersionWarning(REQUIRED_PI_AI_VERSION)).toBeUndefined()
  })

  it('stays silent when the version cannot be read', () => {
    // An unreadable copy is not evidence of a mismatch, and guessing here would
    // produce warnings on healthy installs. Passing undefined explicitly must
    // NOT fall back to the live resolver — otherwise this asserts nothing.
    expect(piAiVersionWarning(undefined)).toBeUndefined()
  })

  it('reads the live module graph when called with no argument', () => {
    // The omitted-argument path is the one production uses; it must consult the
    // resolver rather than treat "no argument" as "unreadable".
    expect(piAiVersionWarning()).toBeUndefined()
    expect(resolvedPiAiVersion()).toBe(REQUIRED_PI_AI_VERSION)
  })

  it('names both versions and a neutral remedy for an older copy', () => {
    const warning = piAiVersionWarning('0.82.1')
    expect(warning).toBeDefined()
    // #92's exact scenario: the co-installed plugin's copy wins resolution.
    expect(warning).toContain('0.82.1')
    expect(warning).toContain(REQUIRED_PI_AI_VERSION)
    expect(warning).toContain('hoisted')
    expect(warning).toContain('autoInstallPeers')
  })

  it('reports a newer copy too', () => {
    // A third-party updater can resolve an untested newer copy too (#86).
    const warning = piAiVersionWarning('1.6.0')
    expect(warning).toBeDefined()
    expect(warning).toContain('1.6.0')
    expect(warning).toContain(REQUIRED_PI_AI_VERSION)
  })

  it('never names a filesystem path', () => {
    // The warning reaches logs and bug reports, so it carries versions and the
    // remedy only — no install location, no user directory. The package name
    // itself contains a slash, so assert on path shapes rather than slashes.
    const warning = piAiVersionWarning('0.82.1') ?? ''
    expect(warning).not.toMatch(/(?:^|\s)\//u) // no absolute path
    expect(warning).not.toMatch(/node_modules/u)
    expect(warning).not.toMatch(/Users|home/u)
  })

  it('carries no plugin prefix, so the logger does not double it', () => {
    // The message is logged as `dsh-workbuddy-connect: ${warning}`. The warning
    // itself must therefore stay unprefixed, or every log line reads
    // "dsh-workbuddy-connect: dsh-workbuddy-connect: ...".
    const warning = piAiVersionWarning('0.82.1') ?? ''
    expect(warning).not.toMatch(/dsh-workbuddy-connect/u)
  })

  it('does not assert a single cause for the mismatch', () => {
    // A hoisted root is what #92 measured, but an installer or updater can leave
    // the wrong copy too. The message offers the hoisted profile as the thing to
    // check, not as a diagnosis — it must not claim to know which happened.
    const warning = piAiVersionWarning('0.82.1') ?? ''
    expect(warning).not.toMatch(/is shadowing it|because|definitely|certainly/u)
    expect(warning).toMatch(/check/u)
  })

  it('resolves a real version in this repository', () => {
    // Guards the resolver itself: if the walk-up or the specifier breaks, this
    // is where it shows, rather than in a silent no-op on every install.
    expect(resolvedPiAiVersion()).toBe(REQUIRED_PI_AI_VERSION)
  })
})
