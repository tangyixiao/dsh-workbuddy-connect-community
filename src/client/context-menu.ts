/// <reference lib="dom" />
/** Locate only this composer's open model root menu, never a different session. */
export function findContextMenu(anchor: Element, provider: string, model: string): HTMLElement | undefined {
  let scope: Element | null = anchor.parentElement
  for (let depth = 0; scope !== null && depth < 6; depth++, scope = scope.parentElement) {
    const triggers = Array.from(scope.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"][aria-expanded="true"][aria-controls]'))
      .filter(button => Array.from(button.querySelectorAll<HTMLElement>('[data-provider-id][data-model-id]')).some(label => label.dataset['providerId'] === provider && label.dataset['modelId'] === model))
    if (triggers.length !== 1) continue
    const id = triggers[0]?.getAttribute('aria-controls')
    const menu = id ? document.getElementById(id) : null
    if (!(menu instanceof HTMLElement) || menu.getAttribute('role') !== 'menu') return undefined
    const items = Array.from(menu.children).filter(child => child.getAttribute('role') === 'menuitem')
    if (items.length < 1 || !items[0]?.querySelector('[data-provider-id][data-model-id]')) return undefined
    return menu
  }
  return undefined
}
