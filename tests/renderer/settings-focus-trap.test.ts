// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { focusables, handleTrapTab } from '@/features/settings/lib/focus-trap'

function makeDialog(): HTMLElement {
  document.body.innerHTML = `
    <button id="outside">Outside</button>
    <div id="dialog">
      <button id="first">First</button>
      <input id="middle" />
      <button id="last">Last</button>
    </div>
  `
  return document.getElementById('dialog') as HTMLElement
}

describe('focusables', () => {
  it('lists only focusable descendants, in DOM order', () => {
    expect(focusables(makeDialog()).map((e) => e.id)).toEqual(['first', 'middle', 'last'])
  })
  it('skips hidden or aria-hidden elements', () => {
    const dialog = makeDialog()
    document.getElementById('middle')!.setAttribute('hidden', '')
    expect(focusables(dialog).map((e) => e.id)).toEqual(['first', 'last'])
  })
  it('returns an empty list when nothing is focusable', () => {
    document.body.innerHTML = '<div id="empty"><span>text</span></div>'
    expect(focusables(document.getElementById('empty')!)).toEqual([])
  })
})

describe('handleTrapTab', () => {
  it('wraps Tab from the last element back to the first', () => {
    const dialog = makeDialog()
    expect(handleTrapTab(dialog, false, document.getElementById('last'))?.id).toBe('first')
  })
  it('wraps Shift+Tab from the first element back to the last', () => {
    const dialog = makeDialog()
    expect(handleTrapTab(dialog, true, document.getElementById('first'))?.id).toBe('last')
  })
  it('leaves an interior Tab press to the browser default (nothing to redirect)', () => {
    const dialog = makeDialog()
    const middle = document.getElementById('middle')
    expect(handleTrapTab(dialog, false, middle)).toBeNull()
    expect(handleTrapTab(dialog, true, middle)).toBeNull()
  })
  it('pulls focus back in when it has landed outside the container', () => {
    const dialog = makeDialog()
    const outside = document.getElementById('outside')
    expect(handleTrapTab(dialog, false, outside)?.id).toBe('first')
    expect(handleTrapTab(dialog, true, outside)?.id).toBe('last')
  })
  it('does nothing when the container has no focusable element', () => {
    document.body.innerHTML = '<div id="empty"></div>'
    expect(handleTrapTab(document.getElementById('empty')!, false, null)).toBeNull()
  })
})
