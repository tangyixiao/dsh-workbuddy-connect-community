// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkBuddyProbeControl, type WorkBuddyProbeControlProps } from '../src/client/WorkBuddyProbeControl.tsx'
import { en } from '../src/client/locales.ts'

it('places the context control under model and reasoning and saves a selection', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = `<div id="composer"><div id="mount"></div><button aria-haspopup="menu" aria-expanded="true" aria-controls="model-menu"><span data-provider-id="workbuddy" data-model-id="hy4free">Hy4</span></button></div><div id="model-menu" role="menu"><button role="menuitem" class="_abc_cell"><span class="_abc_cellLabel">Model</span><span class="_abc_cellValue"><span data-provider-id="workbuddy" data-model-id="hy4free">Hy4</span></span><svg class="_abc_cellChevron"></svg></button><button role="menuitem" class="_abc_cell">Reasoning</button></div>`
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
    const row = menu.querySelector('[data-workbuddy-context-row]') as HTMLButtonElement
    expect(row).not.toBeNull()
    expect(menu.lastElementChild?.contains(row)).toBe(true)
    expect(row.className).toBe('_abc_cell')
    expect(row.querySelector('span')?.className).toBe('_abc_cellLabel')
    expect(row.querySelectorAll('span')[1]?.className).toBe('_abc_cellValue')
    expect(document.querySelector('#composer select')).toBeNull()
    await act(async () => { row.click() })
    const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(options.map(option => option.textContent?.trim().replace('✓', ''))).toEqual(['300K', '600K', '960K'])
    expect(options[2]?.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(options[2])
    expect((menu.children[0] as HTMLElement).hidden).toBe(true)
    expect((menu.children[0] as HTMLElement).style.display).toBe('none')
    expect((menu.children[1] as HTMLElement).hidden).toBe(true)
    expect(options[0]?.className).toContain('_abc_option')
    await act(async () => { options[1]!.click() })
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(call[1]!.body))).toEqual({ action: 'set-model-context-window', model: 'hy4free', account: 'account', window: 600000 })
    expect(menu.querySelector('[data-workbuddy-context-row]')?.textContent).toContain('600K')
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0)
    expect((menu.children[0] as HTMLElement).hidden).toBe(false)
    expect((menu.children[0] as HTMLElement).style.display).toBe('')
    expect((menu.children[1] as HTMLElement).hidden).toBe(false)
    await act(async () => { (menu.querySelector('[data-workbuddy-context-row]') as HTMLButtonElement).click() })
    const group = menu.querySelector('[role="group"]') as HTMLElement
    await act(async () => { group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0)
    expect((menu.children[0] as HTMLElement).hidden).toBe(false)
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = '' }
})
