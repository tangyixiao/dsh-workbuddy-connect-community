import { describe, expect, it, vi } from 'vitest'
import type { WorkBuddyUpdateFetch } from '../src/update.ts'
import {
  checkWorkBuddyUpdate,
  compareWorkBuddyVersions,
  parseWorkBuddyUpdateResult,
  parseWorkBuddyVersion,
  releasePageUrl,
  WORKBUDDY_REPOSITORY_URL,
  WORKBUDDY_UPDATE_RELEASES_API_URL,
} from '../src/update.ts'

function jsonResponse(body: unknown, padBytes = 0): Response {
  return new Response(JSON.stringify(body) + ' '.repeat(padBytes), { status: 200 })
}

function releaseEntry(tag: string, options: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag_name: tag, draft: false, prerelease: false, name: 'summary', body: 'notes', published_at: '2026-09-26T06:42:04Z', ...options }
}

function githubFetch(releases: unknown): WorkBuddyUpdateFetch {
  return async input => {
    expect(input).toBe(WORKBUDDY_UPDATE_RELEASES_API_URL)
    return jsonResponse(releases)
  }
}

describe('version comparison', () => {
  it('orders plain SemVer numerically, never lexically', () => {
    expect(compareWorkBuddyVersions('0.6.10', '0.6.2')).toBeGreaterThan(0)
    expect(compareWorkBuddyVersions('0.6.3', 'v0.6.3')).toBe(0)
    expect(compareWorkBuddyVersions('0.7.0-alpha.1', '0.7.0')).toBeLessThan(0)
    expect(parseWorkBuddyVersion('not-a-version')).toBeUndefined()
    expect(parseWorkBuddyVersion('01.2.3')).toBeUndefined()
    expect(parseWorkBuddyVersion('1.2.3-alpha.01')).toBeUndefined()
    expect(parseWorkBuddyVersion('9007199254740992.0.0')).toBeUndefined()
  })
})

describe('independent GitHub release updates', () => {
  it('requests only our repository without credentials or redirects', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([releaseEntry('v0.1.0')]))
    expect(await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl })).toEqual({ status: 'up-to-date', currentVersion: '0.1.0', latestVersion: '0.1.0' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(WORKBUDDY_UPDATE_RELEASES_API_URL, expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: { accept: 'application/vnd.github+json' } }))
    expect(WORKBUDDY_UPDATE_RELEASES_API_URL).toBe('https://api.github.com/repos/tangyixiao/dsh-workbuddy-connect-community/releases?per_page=100')
  })

  it('rejects an invalid current version without any request', async () => {
    const fetchImpl = vi.fn()
    expect(await checkWorkBuddyUpdate({ currentVersion: 'dev', fetchImpl })).toEqual({ status: 'unavailable', currentVersion: 'dev', reason: 'invalid-current-version' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('selects the highest stable version, skipping malformed, draft and prerelease entries', async () => {
    const result = await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl: githubFetch([
      releaseEntry('v0.2.0', { body: '- fix one\n- fix two' }), releaseEntry('v0.1.1'),
      releaseEntry('0.2.0+build'), releaseEntry('v0.1.0'),
      releaseEntry('v8.0.0', { draft: true }), releaseEntry('v9.0.0', { prerelease: true }),
      releaseEntry('v10.0.0-beta.1'), releaseEntry('01.0.0'),
      releaseEntry('v11.0.0', { draft: 'false' }), { tag_name: '12.0.0' }, null, 7,
    ]) })
    expect(result).toMatchObject({ status: 'update-available', latestVersion: '0.2.0', releaseUrl: releasePageUrl('0.2.0'), versionsBehind: 2 })
    if (result.status !== 'update-available') throw new Error('unreachable')
    expect(result.releases.map(release => release.version)).toEqual(['v0.2.0', 'v0.1.1'])
    expect(result.releases[0]).toMatchObject({ notes: '- fix one\n- fix two', publishedAt: '2026-09-26T06:42:04Z' })
    expect(parseWorkBuddyUpdateResult(result)).toEqual(result)
  })

  it('keeps the release URL consistent with the actual non-v tag', async () => {
    const result = await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl: githubFetch([releaseEntry('0.2.0+build')]) })
    expect(result).toMatchObject({ latestVersion: '0.2.0', releaseUrl: `${WORKBUDDY_REPOSITORY_URL}/releases/tag/0.2.0%2Bbuild` })
    expect(parseWorkBuddyUpdateResult(result)).toEqual(result)
  })

  it.each([[], [releaseEntry('v1.0.0', { draft: true })], {}, 'junk', Array.from({ length: 101 }, () => releaseEntry('v0.1.0'))].map(releases => [releases] as const))('does not treat missing or invalid release evidence as up-to-date: %j', async releases => {
    expect(await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl: githubFetch(releases) })).toMatchObject({ status: 'unavailable', reason: 'invalid-registry-response' })
  })

  it('reports network and HTTP failures as unavailable', async () => {
    for (const fetchImpl of [async () => { throw new Error('offline') }, async () => new Response('', { status: 403 })]) {
      expect(await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl })).toMatchObject({ status: 'unavailable', reason: 'registry-unavailable' })
    }
  })

  it('bounds body size and rejects invalid JSON', async () => {
    for (const response of [jsonResponse([], 1024 * 1024 + 1), new Response('{')]) {
      expect(await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl: async () => response })).toMatchObject({ status: 'unavailable', reason: 'invalid-registry-response' })
    }
  })

  it('aborts timed out requests', async () => {
    const fetchImpl: WorkBuddyUpdateFetch = async (_url, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    expect(await checkWorkBuddyUpdate({ currentVersion: '0.1.0', fetchImpl, timeoutMs: 5 })).toMatchObject({ status: 'unavailable', reason: 'registry-unavailable' })
  })

  it('treats an older published stable release as current without claiming a downgrade', async () => {
    expect(await checkWorkBuddyUpdate({ currentVersion: '0.2.0', fetchImpl: githubFetch([releaseEntry('v0.1.0')]) })).toMatchObject({ status: 'up-to-date', latestVersion: '0.2.0' })
  })
})

describe('the browser-side re-validation', () => {
  const goodResult = {
    status: 'update-available',
    currentVersion: '0.6.1',
    latestVersion: '0.6.4',
    releaseUrl: releasePageUrl('0.6.4'),
    releases: [
      { version: 'v0.6.4', name: 'summary', notes: 'notes', publishedAt: '2026-09-26T06:42:04Z' },
      { version: 'v0.6.3' },
    ],
    versionsBehind: 2,
  }

  it('accepts a well-formed result', () => {
    expect(parseWorkBuddyUpdateResult(goodResult)).toEqual(goodResult)
  })

  it('rejects a release URL the version does not spell', () => {
    for (const releaseUrl of ['https://evil.example/x', 'https://github.com/corrinehu/dsh-workbuddy-connect/releases/tag/v0.6.4', `${WORKBUDDY_REPOSITORY_URL}/releases/tag/v0.6.4?x=1`, `${WORKBUDDY_REPOSITORY_URL}/releases/tag/v0.6.5`]) {
      expect(parseWorkBuddyUpdateResult({ ...goodResult, releaseUrl })).toBeUndefined()
    }
  })

  it('rejects releases outside (current, latest] and duplicate versions', () => {
    expect(parseWorkBuddyUpdateResult({ ...goodResult, releases: [{ version: 'v0.5.9' }] })).toBeUndefined()
    expect(parseWorkBuddyUpdateResult({ ...goodResult, releases: [{ version: 'v0.6.4' }, { version: '0.6.4+build' }] })).toBeUndefined()
    expect(parseWorkBuddyUpdateResult({ ...goodResult, releases: [{ version: 'v0.6.4-beta.1' }] })).toBeUndefined()
    expect(parseWorkBuddyUpdateResult({ ...goodResult, releases: [{ version: 'v0.9.9' }] })).toBeUndefined()
    expect(parseWorkBuddyUpdateResult({ ...goodResult, releases: [{ version: 'v0.6.4' }, { version: 'v0.6.4' }] })).toBeUndefined()
  })

  it('rejects a versionsBehind that disagrees with the list', () => {
    expect(parseWorkBuddyUpdateResult({ ...goodResult, versionsBehind: 5 })).toBeUndefined()
    expect(parseWorkBuddyUpdateResult({ ...goodResult, versionsBehind: '2' })).toBeUndefined()
  })

  it('rejects an update-available whose latest does not exceed current', () => {
    expect(parseWorkBuddyUpdateResult({ ...goodResult, latestVersion: '0.6.1' })).toBeUndefined()
  })

  it('carries the unavailable reasons through', () => {
    expect(parseWorkBuddyUpdateResult({ status: 'unavailable', currentVersion: '0.6.3', reason: 'registry-unavailable' }))
      .toEqual({ status: 'unavailable', currentVersion: '0.6.3', reason: 'registry-unavailable' })
    expect(parseWorkBuddyUpdateResult({ status: 'unavailable', currentVersion: '0.6.3', reason: 'something-else' })).toBeUndefined()
    expect(parseWorkBuddyUpdateResult('junk')).toBeUndefined()
  })
})
