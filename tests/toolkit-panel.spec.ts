import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyToolkitPanel } from '../src/client/WorkBuddyToolkitPanel.tsx'
import { toolkitEn, type ToolkitLocaleKey } from '../src/client/toolkit-locales.ts'

const a = `cn-${'a'.repeat(32)}`; const b = `cn-${'b'.repeat(32)}`
const translate = (key: ToolkitLocaleKey, params: Record<string, unknown> = {}): string => Object.entries(params).reduce<string>((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), toolkitEn[key])
function initial() {
  return { provider: 'workbuddy', key: 'private-control-key', account: a,
    accounts: { revision: 'account-revision', mode: 'saved-account', accounts: [{ id: a, region: 'cn', selected: true, label: 'Primary', expiresAtMs: 1900000000000 }, { id: b, region: 'cn', selected: false, label: 'Backup', expiresAtMs: 1900000000000 }] },
    settings: { revision: 'settings-revision', features: { images: false, videos: false, cli: false, contextRescue: false }, automation: { rotate: false, checkin: false, members: [] as string[], maxSwitches: 1 }, cli: { workspace: '', model: '', effort: '', timeoutMs: 60_000, maxTurns: 3 } },
    capabilities: { tools: true, approval: true, context: true, cli: true, media: true, checkin: true },
  }
}
describe('account and toolkit panel', () => {
  let view: ReactTestRenderer | undefined
  let state: ReturnType<typeof initial>
  const request = vi.fn()
  beforeEach(() => { state = initial(); request.mockReset().mockImplementation(async () => ({ ok: true, status: 200, json: async () => structuredClone(state) })); vi.stubGlobal('fetch', request) })
  afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals() })
  async function mount(): Promise<void> {
    await act(async () => { view = create(createElement(WorkBuddyToolkitPanel, { provider: 'workbuddy', t: translate })) })
    await act(async () => { view!.root.findByProps({ 'data-toolkit-disclosure': true }).props.onClick() })
  }
  const checkbox = (key: string) => view!.root.findByProps({ 'data-toolkit-feature': key })
  const button = (label: string) => view!.root.findAllByType('button').find(node => node.children.join('') === label)!

  it('reads once on first expansion, defaults every effect off, and never selects automation members implicitly', async () => {
    await mount()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]![0]).toBe('/plugins/dsh-workbuddy-connect/toolkit')
    for (const name of ['images', 'videos', 'cli', 'contextRescue']) expect(checkbox(name).props.checked).toBe(false)
    expect(view!.root.findAllByProps({ 'data-toolkit-member': true }).every(node => !node.props.checked)).toBe(true)
    expect(JSON.stringify(view!.toJSON())).not.toContain('private-control-key')
  })

  it('waits for server confirmation, submits exact consent scope, and serializes requests', async () => {
    await mount()
    let release!: () => void
    request.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { await new Promise<void>(resolve => { release = resolve }); state.settings.features.images = true; return { ok: true, status: 200, json: async () => ({ state: 'ok' }) } }
      return { ok: true, status: 200, json: async () => structuredClone(state) }
    })
    act(() => { checkbox('images').props.onChange({ currentTarget: { checked: true } }) })
    expect(checkbox('images').props.checked).toBe(false)
    expect(checkbox('images').props.disabled).toBe(true)
    act(() => { checkbox('videos').props.onChange({ currentTarget: { checked: true } }) })
    expect(request.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
    const post = request.mock.calls.find(call => call[1]?.method === 'POST')![1] as RequestInit
    expect(post.headers).toMatchObject({ 'X-WorkBuddy-Toolkit-Key': 'private-control-key' })
    expect(JSON.parse(post.body as string)).toEqual({ action: 'update-settings', revision: 'settings-revision', account: a, patch: { features: { images: true } } })
    await act(async () => { release() })
    expect(checkbox('images').props.checked).toBe(true)
  })

  it('refreshes stale state and shows fixed user-facing copy without raw errors', async () => {
    await mount()
    request.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { state.settings.revision = 'fresh-revision'; return { ok: false, status: 409, json: async () => ({ error: 'private-host-diagnostic' }) } }
      return { ok: true, status: 200, json: async () => structuredClone(state) }
    })
    await act(async () => { checkbox('images').props.onChange({ currentTarget: { checked: true } }) })
    expect(request).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitStale)
    expect(JSON.stringify(view!.toJSON())).not.toContain('private-host-diagnostic')
    expect(checkbox('images').props.checked).toBe(false)
  })

  it('uses durable account revisions and prevents removal of the selected account', async () => {
    await mount()
    expect(view!.root.findByProps({ 'aria-label': 'Remove Primary' }).props.disabled).toBe(true)
    await act(async () => { view!.root.findByProps({ 'aria-label': 'Select Backup as primary' }).props.onClick() })
    const post = request.mock.calls.find(call => call[1]?.method === 'POST')![1]
    expect(JSON.parse(post.body)).toEqual({ action: 'select-account', revision: 'account-revision', id: b })
  })

  it('shows unknown capabilities without enabling unavailable actions', async () => {
    state.capabilities = {} as typeof state.capabilities
    await mount()
    expect(checkbox('images').props.disabled).toBe(true)
    expect(checkbox('videos').props.disabled).toBe(true)
    expect(checkbox('contextRescue').props.disabled).toBe(true)
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitUnavailable)
  })

  it('requires persisted CLI workspace and model before enabling and saves a bounded owner configuration', async () => {
    await mount()
    expect(checkbox('cli').props.disabled).toBe(true)
    await act(async () => {
      view!.root.findByProps({ name: 'workspace' }).props.onChange({ currentTarget: { value: 'D:\\workspace' } })
      view!.root.findByProps({ name: 'model' }).props.onChange({ currentTarget: { value: 'hy4-preview' } })
      view!.root.findByProps({ name: 'effort' }).props.onChange({ currentTarget: { value: 'high' } })
    })
    expect(checkbox('cli').props.disabled).toBe(true)
    await act(async () => { view!.root.findByProps({ 'data-toolkit-cli-form': true }).props.onSubmit({ preventDefault() {} }) })
    const post = request.mock.calls.find(call => call[1]?.method === 'POST')![1]
    expect(JSON.parse(post.body)).toMatchObject({ action: 'update-settings', revision: 'settings-revision', account: a, patch: { cli: { workspace: 'D:\\workspace', model: 'hy4-preview', effort: 'high', timeoutMs: 60_000, maxTurns: 3 } } })
  })

  it('aborts an in-flight request when unmounted', async () => {
    let signal: AbortSignal | undefined
    request.mockImplementation(async (_url: string, init?: RequestInit) => { signal = init?.signal as AbortSignal; return await new Promise(() => {}) })
    await act(async () => { view = create(createElement(WorkBuddyToolkitPanel, { provider: 'workbuddy', t: translate })) })
    await act(async () => { view!.root.findByProps({ 'data-toolkit-disclosure': true }).props.onClick() })
    act(() => { view!.unmount() }); view = undefined
    expect(signal?.aborted).toBe(true)
  })

  it('adds exactly one explicitly chosen automation member without selecting that account', async () => {
    await mount()
    await act(async () => { view!.root.findAllByProps({ 'data-toolkit-member': true })[1]!.props.onChange({ currentTarget: { checked: true } }) })
    const posts = request.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(call[1].body))
    expect(posts).toEqual([{ action: 'update-settings', revision: 'settings-revision', account: a, patch: { automation: { members: [b] } } }])
    expect(view!.root.findAllByProps({ 'data-toolkit-member': true }).every(node => !node.props.checked)).toBe(true)
  })

  it('refuses malformed or cross-product documents instead of rendering writable controls', async () => {
    request.mockImplementation(async () => ({ ok: true, json: async () => ({ ...state, provider: 'workbuddy-ai' }) }))
    await mount()
    expect(view!.root.findAllByProps({ 'data-toolkit-feature': 'images' })).toHaveLength(0)
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitLoadFailure)
  })

  it('binds a manual check-in to the current consent owner as well as the target and account revision', async () => {
    await mount()
    await act(async () => { view!.root.findByProps({ 'aria-label': 'Check in Backup' }).props.onClick() })
    const post = request.mock.calls.find(call => call[1]?.method === 'POST')![1]
    expect(JSON.parse(post.body)).toEqual({ action: 'checkin', revision: 'account-revision', account: a, id: b })
  })

  it('does not read accounts while its disclosure stays collapsed', async () => {
    await act(async () => { view = create(createElement(WorkBuddyToolkitPanel, { provider: 'workbuddy', t: translate })) })
    expect(request).not.toHaveBeenCalled()
  })

  it('names the actual serving account and renders real pending/exhausted policy states', async () => {
    let decision = { state: 'serving', switches: 1, servingAccount: b }
    request.mockImplementation(async () => ({ ok: true, json: async () => ({ ...state, decision }) }))
    await mount()
    expect(view!.root.findByProps({ 'data-toolkit-serving-account': true }).children.join('')).toBe('Request account: Backup')
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitDecisionRotated)
    decision = { ...decision, state: 'exhausted' }
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitDecisionStopped)
    decision = { ...decision, state: 'pending', servingAccount: a }
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    expect(view!.root.findByProps({ 'data-toolkit-serving-account': true }).children.join('')).toBe('Request account: Primary')
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitDecisionPending)
  })

  it('distinguishes confirmed existing check-in and ineligible account from uncertain outcomes', async () => {
    let checkin = { state: 'already-checked-in' }
    request.mockImplementation(async () => ({ ok: true, json: async () => ({ ...state, checkin }) }))
    await mount()
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitCheckinAlready)
    expect(JSON.stringify(view!.toJSON())).not.toContain(toolkitEn.toolkitCheckinUnknown)
    checkin = { state: 'not-eligible' }
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitCheckinIneligible)
    expect(JSON.stringify(view!.toJSON())).not.toContain(toolkitEn.toolkitCheckinUnknown)
  })
})
