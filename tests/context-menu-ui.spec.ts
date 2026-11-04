// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkBuddyProbeControl, type WorkBuddyProbeControlProps } from '../src/client/WorkBuddyProbeControl.tsx'
import { en } from '../src/client/locales.ts'

it('places the context control under model and reasoning and saves a selection', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = `<div id="composer"><div id="mount"></div><button aria-haspopup="menu" aria-expanded="true" aria-controls="model-menu"><span data-provider-id="workbuddy" data-model-id="hy4free">Hy4</span></button></div><div id="model-menu" role="menu"><button role="menuitem"><span data-provider-id="workbuddy" data-model-id="hy4free">Hy4</span></button><button role="menuitem">Reasoning</button></div>`
  const model = { id: 'hy4free', name: 'Hy4', contextWindow: 960000, supportedContextWindows: [300000, 600000, 960000] }
  const status = { status: 'signed-in', probeKey: 'key', visibility: { account: 'account', disabled: [] }, models: [model] }
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { model.contextWindow = 600000; return { ok: true, json: async () => ({ state: 'updated' }) } }
    return { ok: true, json: async () => status }
  })
  vi.stubGlobal('fetch', fetchMock)
  const snapshot = { current: { provider: 'workbuddy', model: 'hy4free' } }
  const directory = { getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as WorkBuddyProbeControlProps['directory']
  const root = createRoot(document.querySelector('#mount')!)
  try {
    await act(async () => { root.render(createElement(WorkBuddyProbeControl, { directory, t: key => en[key] })) })
    const menu = document.querySelector('#model-menu')!
    const picker = menu.querySelector('select')!
    expect(picker).not.toBeNull()
    expect(menu.lastElementChild?.contains(picker)).toBe(true)
    expect(document.querySelector('#composer select')).toBeNull()
    await act(async () => { picker.value = '600000'; picker.dispatchEvent(new Event('change', { bubbles: true })) })
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(call[1]!.body))).toEqual({ action: 'set-model-context-window', model: 'hy4free', account: 'account', window: 600000 })
    expect(picker.value).toBe('600000')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = '' }
})
