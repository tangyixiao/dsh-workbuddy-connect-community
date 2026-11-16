import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyToolkitPanel, parseToolkitWebState } from '../src/client/WorkBuddyToolkitPanel.tsx'
import { toolkitEn, type ToolkitLocaleKey } from '../src/client/toolkit-locales.ts'

const a = `cn-${'a'.repeat(32)}`; const b = `cn-${'b'.repeat(32)}`
const translate = (key: ToolkitLocaleKey, params: Record<string, unknown> = {}): string => Object.entries(params).reduce<string>((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), toolkitEn[key])
const totals = (requests = 2) => ({ requests, knownCreditRequests: 1, unknownCreditRequests: requests - 1, observedCredits: 3 })
const windows = () => ({ '1': totals(), '7': totals(3), '30': totals(4) })
function observations() {
  return {
    accountCredits: { [a]: { credits: { total: 0, unlimited: true, accounts: [] }, refreshedAt: 1800000000000, error: 'credits-unavailable' }, [b]: { credits: { total: 9, accounts: [], expiry: { within24h: { total: 2, packages: 1 }, within3d: { total: 2, packages: 1 }, within7d: { total: 5, packages: 2 } } } } },
    checkinResults: { [b]: { account: b, time: 1800000000000, source: 'automatic', outcome: 'unknown' } },
    checkin: { state: 'succeeded', credits: 999 },
    usage: { status: 'storage-unavailable', persistence: 'unavailable', coverage: { retentionDays: 31, maxRecords: 5000, maxBytes: 4194304, from: 1800000000000, to: 1800000000100, truncated: true }, windows: windows(), byAccount: [{ account: b, windows: windows() }], byModel: [{ model: 'test-model', windows: windows() }], recent: [{ account: b, model: 'test-model', responseId: 'response-1', completedAt: 1800000000000 }] },
  }
}
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

  it.each([true, false])('removes invisible deleted accounts when editing automation membership (checked=%s)', async checked => {
    state.accounts.accounts = state.accounts.accounts.filter(account => account.id !== b)
    state.settings.automation.members = checked ? [b] : [a, b]
    request.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const members = JSON.parse(String(init.body)).patch.automation.members as string[]
        if (members.some(id => !state.accounts.accounts.some(account => account.id === id))) return { ok: false, status: 400, json: async () => ({ error: 'account-not-found' }) }
        state.settings.automation.members = members; state.settings.revision = 'fresh-settings'
        return { ok: true, status: 200, json: async () => ({ state: 'updated' }) }
      }
      return { ok: true, status: 200, json: async () => structuredClone(state) }
    })
    await mount()
    await act(async () => { view!.root.findByProps({ 'data-toolkit-member': true }).props.onChange({ currentTarget: { checked } }) })
    const posts = request.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(call[1].body))
    expect(posts).toEqual([{ action: 'update-settings', revision: 'settings-revision', account: a, patch: { automation: { members: checked ? [a] : [] } } }])
    expect(view!.root.findByProps({ 'data-toolkit-member': true }).props.checked).toBe(checked)
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

  it('retains the last successful display read-only after transport failure until a valid read', async () => {
    await mount()
    const staleHandler = checkbox('images').props.onChange
    request.mockRejectedValue(new Error('private-network-error'))
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    expect(JSON.stringify(view!.toJSON())).toContain('Primary')
    expect(checkbox('images').props.disabled).toBe(true)
    const calls = request.mock.calls.length
    await act(async () => { staleHandler({ currentTarget: { checked: true } }) })
    expect(request).toHaveBeenCalledTimes(calls)
    request.mockResolvedValue({ ok: true, status: 200, json: async () => structuredClone(state) })
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    expect(checkbox('images').props.disabled).toBe(false)
  })

  it('retains data read-only when a mutation and its read-back both fail', async () => {
    await mount()
    request.mockRejectedValue(new Error('private-network-error'))
    await act(async () => { checkbox('images').props.onChange({ currentTarget: { checked: true } }) })
    expect(JSON.stringify(view!.toJSON())).toContain('Primary')
    expect(checkbox('images').props.disabled).toBe(true)
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitUncertain)
  })

  it.each([401, 403])('clears private state on HTTP %s including a denied mutation', async status => {
    await mount()
    request.mockResolvedValue({ ok: false, status })
    await act(async () => { checkbox('images').props.onChange({ currentTarget: { checked: true } }) })
    expect(JSON.stringify(view!.toJSON())).not.toContain('Primary')
    expect(view!.root.findAllByProps({ 'data-toolkit-feature': 'images' })).toHaveLength(0)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('aborts and clears old state when provider changes and ignores a late old response', async () => {
    await mount()
    let finish!: (value: unknown) => void
    let signal: AbortSignal | undefined
    request.mockImplementationOnce((_url: string, init?: RequestInit) => { signal = init?.signal as AbortSignal; return new Promise(resolve => { finish = resolve }) })
    act(() => { button(toolkitEn.toolkitRefresh).props.onClick() })
    request.mockResolvedValue({ ok: false, status: 503 })
    await act(async () => { view!.update(createElement(WorkBuddyToolkitPanel, { provider: 'workbuddy-ai', t: translate })) })
    expect(signal?.aborted).toBe(true)
    await act(async () => { finish({ ok: true, json: async () => structuredClone(state) }) })
    expect(JSON.stringify(view!.toJSON())).not.toContain('Primary')
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

  it('shows explicit cached quota refresh actions without changing selected account', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ ...state, ...observations() }) })
    await mount()
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(view!.toJSON())).toContain('Unlimited')
    expect(JSON.stringify(view!.toJSON())).not.toContain('Available: 0 credits')
    expect(JSON.stringify(view!.toJSON())).toContain('Expiry information unavailable')
    expect(JSON.stringify(view!.toJSON())).toContain('Expiring within 24 hours: 2 credits')
    expect(JSON.stringify(view!.toJSON())).toContain('Expiring within 7 days: 5 credits')
    await act(async () => { view!.root.findByProps({ 'aria-label': 'Refresh credits for Backup' }).props.onClick() })
    await act(async () => { button('Refresh all account credits').props.onClick() })
    const actions = request.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(call[1].body))
    expect(actions).toEqual([{ action: 'refresh-account-credits', revision: 'account-revision', account: a, id: b }, { action: 'refresh-account-credits', revision: 'account-revision', account: a }])
  })

  it('names check-in targets and usage rows, changes rolling windows and discloses incomplete history', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ ...state, ...observations() }) })
    await mount()
    let rendered = JSON.stringify(view!.toJSON())
    const checkin = view!.root.findAllByType('p').find(node => node.children.join('').includes('Backup · Automatic check-in'))
    expect(checkin?.children.join('')).toContain(toolkitEn.toolkitCheckinUnknown)
    expect(rendered).not.toContain('999')
    expect(rendered).toContain('2 requests · 3 observed credits · 1 unknown-credit requests')
    expect(rendered).toContain('Only completed requests observed through this plugin')
    expect(rendered).toContain('History has been truncated')
    expect(rendered).toContain('History storage is unavailable')
    expect(rendered).toContain('response-1')
    expect(rendered).not.toContain(b)
    await act(async () => { view!.root.findByProps({ 'aria-label': 'Usage period' }).props.onChange({ currentTarget: { value: '30' } }) })
    rendered = JSON.stringify(view!.toJSON())
    expect(rendered).toContain('4 requests · 3 observed credits · 3 unknown-credit requests')
  })

  it('replaces private statistics with a valid signed-out document but keeps saved-account recovery', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ ...state, ...observations() }) })
    await mount()
    const { account: _account, settings: _settings, ...signedOut } = state
    request.mockResolvedValue({ ok: true, json: async () => signedOut })
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    const rendered = JSON.stringify(view!.toJSON())
    expect(rendered).toContain('Backup')
    expect(rendered).not.toContain('response-1')
    expect(rendered).not.toContain('Unlimited')
    expect(checkbox('images').props.disabled).toBe(true)
    expect(button('Refresh all account credits').props.disabled).toBe(true)
  })

  it('validates optional observation bounds and account regions before display', () => {
    const fixture = () => ({ ...initial(), ...observations() })
    expect(parseToolkitWebState(fixture(), 'workbuddy')).toBeDefined()
    expect(parseToolkitWebState({ ...fixture(), accountCredits: { [a]: { credits: { total: 0, accounts: [{ packageName: '', remain: 0, size: 0 }] } } } }, 'workbuddy')).toBeDefined()
    const invalid: unknown[] = [
      { ...fixture(), accountCredits: { [a]: { credits: { total: -1, accounts: [] } } } },
      { ...fixture(), checkinResults: { [b]: { account: a, source: 'automatic', outcome: 'unknown', time: 1 } } },
      { ...fixture(), usage: { ...observations().usage, recent: Array(101).fill(observations().usage.recent[0]) } },
      { ...fixture(), usage: { ...observations().usage, byAccount: [{ account: `global-${'a'.repeat(32)}`, windows: windows() }] } },
      { ...fixture(), usage: { ...observations().usage, windows: { ...windows(), '1': { ...totals(), observedCredits: Infinity } } } },
      { ...fixture(), checkinResults: { [b]: { account: b, source: ['automatic'], outcome: 'unknown', time: 1 } } },
      { ...fixture(), usage: { ...observations().usage, status: ['available'] } },
      { ...fixture(), accountCredits: { [`global-${'a'.repeat(32)}`]: {} } },
      { ...fixture(), accountCredits: { [a]: { refreshedAt: NaN } } },
      { ...fixture(), usage: { ...observations().usage, recent: [{ ...observations().usage.recent[0], credit: -1 }] } },
    ]
    for (const value of invalid) expect(parseToolkitWebState(value, 'workbuddy')).toBeUndefined()
  })

  it('renders absent extensions as unknown and keeps an invalid extension refresh read-only', async () => {
    await mount()
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitCreditsUnknown)
    expect(JSON.stringify(view!.toJSON())).toContain(toolkitEn.toolkitUsageUnavailable)
    request.mockResolvedValue({ ok: true, json: async () => ({ ...state, usage: { ...observations().usage, recent: Array(101).fill({}) } }) })
    await act(async () => { button(toolkitEn.toolkitRefresh).props.onClick() })
    expect(JSON.stringify(view!.toJSON())).toContain('Primary')
    expect(button('Refresh all account credits').props.disabled).toBe(true)
  })

  it('renders confirmed zero credits and manual check-in reward without treating unknown as zero', async () => {
    const extra = observations()
    request.mockResolvedValue({ ok: true, json: async () => ({ ...state, ...extra, checkinResults: { [b]: { account: b, time: 1800000000000, source: 'manual', outcome: 'succeeded', credit: 0 } }, usage: { ...extra.usage, recent: [...extra.usage.recent, { ...extra.usage.recent[0], responseId: 'response-zero', credit: 0 }] } }) })
    await mount()
    const rendered = JSON.stringify(view!.toJSON())
    expect(rendered).toContain('Confirmed reward: 0 credits')
    expect(rendered).toContain('Observed: 0 credits')
    expect(rendered).toContain('Credits unknown')
    const checkin = view!.root.findAllByType('p').find(node => node.children.join('').includes('Backup · Manual check-in'))
    expect(checkin?.children.join('')).toContain('Check-in confirmed')
  })
})
