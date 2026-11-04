/// <reference lib="dom" />
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { findContextMenu } from '../src/client/context-menu.ts'

describe('model menu anchor', () => {
  it('selects the matching open root menu and rejects the wrong model or drilled pane', () => {
    document.body.innerHTML = `<div id="composer"><span id="anchor"></span><button aria-haspopup="menu" aria-expanded="true" aria-controls="model-menu"><span data-provider-id="workbuddy" data-model-id="hy4free">Hy4</span></button></div><div id="model-menu" role="menu"><button role="menuitem"><span data-provider-id="workbuddy" data-model-id="hy4free">Hy4</span></button><button role="menuitem">Reasoning</button></div>`
    const anchor = document.querySelector('#anchor')!
    const menu = document.querySelector('#model-menu')!
    expect(findContextMenu(anchor, 'workbuddy', 'hy4free')).toBe(menu)
    expect(findContextMenu(anchor, 'workbuddy', 'other')).toBeUndefined()
    menu.innerHTML = '<button role="menuitemradio">High</button>'
    expect(findContextMenu(anchor, 'workbuddy', 'hy4free')).toBeUndefined()
  })
})
