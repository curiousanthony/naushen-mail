import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '../../src/renderer/lib/store'
import { HANDLERS } from '../../src/renderer/features/commands/runner'

/**
 * Regression coverage: 'nav.back' (Escape) used to only close an overlay or the reader, never a
 * composer — so the documented "Exit draft: esc" shortcut silently did nothing. Also covers the
 * priority order once a composer was added: a modal overlay sits above a floating composer, so
 * it must close first when both are open.
 */
describe("nav.back ('Escape') priority", () => {
  beforeEach(() => {
    useApp.setState({ composers: [], overlay: null, openThreadId: null, selectedIds: [], accounts: [], accountId: 'all' })
  })

  it('closes the topmost composer when nothing modal is in front', () => {
    const id1 = useApp.getState().openComposer()
    const id2 = useApp.getState().openComposer()
    HANDLERS['nav.back']({})
    expect(useApp.getState().composers.map((c) => c.id)).toEqual([id1])
    HANDLERS['nav.back']({})
    expect(useApp.getState().composers).toHaveLength(0)
  })

  it('closes an overlay before reaching a composer behind it', () => {
    useApp.getState().openComposer()
    useApp.setState({ overlay: 'palette' })
    HANDLERS['nav.back']({})
    expect(useApp.getState().overlay).toBeNull()
    expect(useApp.getState().composers).toHaveLength(1) // untouched
  })

  it('falls through to closing the reader, then clearing selection, once nothing else is open', () => {
    useApp.setState({ openThreadId: 't1' })
    HANDLERS['nav.back']({})
    expect(useApp.getState().openThreadId).toBeNull()

    useApp.setState({ selectedIds: ['a', 'b'] })
    HANDLERS['nav.back']({})
    expect(useApp.getState().selectedIds).toEqual([])
  })
})
