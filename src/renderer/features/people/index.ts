/**
 * People feature (feat/quickfind-people): local contact index access, the sender hover card
 * and the `i` "sender info" command. <SenderCard/> is hosted by CommandPalette.
 */
import { useApp } from '@/lib/store'
import i18n from '@/i18n'
import { cancelClose, cancelOpen, usePeopleUi } from './store'

export { SenderCard } from './SenderCard'
export { SenderName } from './SenderName'
export { PersonAvatar } from './Avatar'
export { searchPeople, getPersonInfo } from './data'
export { composeTo, allMailFrom, copyAddress } from './actions'

/**
 * `i`: toggle the sender card for the conversation you are looking at. Anchors to the last
 * sender in the open reader that isn't you; with no reader open, to the focused list row's
 * first other participant.
 */
export function toggleSenderInfo(): void {
  const ui = usePeopleUi.getState()
  if (ui.card) { ui.close(); return }
  cancelOpen(); cancelClose()
  const s = useApp.getState()
  const mine = new Set(s.accounts.map((a) => a.email.toLowerCase()))

  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-person]'))
  const theirs = els.filter((el) => !mine.has((el.dataset.person ?? '').toLowerCase()))
  const el = (theirs.length ? theirs : els).slice(-1)[0]
  if (el?.dataset.person) {
    const r = el.getBoundingClientRect()
    ui.open({ email: el.dataset.person, name: el.textContent && el.textContent !== el.dataset.person ? el.textContent : undefined, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, via: 'key' })
    return
  }
  const th = s.threads.find((t) => t.id === (s.openThreadId ?? s.focusedId))
  const who = th?.participants.find((p) => !mine.has(p.email.toLowerCase())) ?? th?.participants[0]
  const row = document.querySelector<HTMLElement>('[data-focused="true"]')
  if (who && row) {
    const r = row.getBoundingClientRect()
    ui.open({ email: who.email, name: who.name, rect: { left: r.left + 24, top: r.top, right: r.right, bottom: r.bottom }, via: 'key' })
    return
  }
  s.toast({ message: i18n.t('people:selectFirst'), duration: 2200 })
}
