import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '../../src/renderer/lib/store'

/**
 * Regression coverage for a real bug: two independent code paths (reader's own keydown
 * listener and commands' global table) both used to call openComposer() for the same 'r'
 * keypress, stacking two reply composers. Fixed by deduping in the store itself — see
 * src/renderer/lib/store.ts's openComposer.
 */
describe('openComposer dedup', () => {
  beforeEach(() => { useApp.setState({ composers: [], accounts: [], accountId: 'all' }) })

  it('reuses the existing composer for the same reply mode + thread instead of stacking a duplicate', () => {
    const id1 = useApp.getState().openComposer({ mode: 'reply', threadId: 't1', messageId: 'm1', placement: 'inline' })
    const id2 = useApp.getState().openComposer({ mode: 'reply', threadId: 't1', messageId: 'm1', placement: 'inline' })
    expect(id2).toBe(id1)
    expect(useApp.getState().composers).toHaveLength(1)
  })

  it('does not dedupe across different modes or threads', () => {
    useApp.getState().openComposer({ mode: 'reply', threadId: 't1', messageId: 'm1', placement: 'inline' })
    useApp.getState().openComposer({ mode: 'replyAll', threadId: 't1', messageId: 'm1', placement: 'inline' })
    useApp.getState().openComposer({ mode: 'reply', threadId: 't2', messageId: 'm2', placement: 'inline' })
    expect(useApp.getState().composers).toHaveLength(3)
  })

  it('never dedupes plain "new" composers — several blank drafts is intentional', () => {
    useApp.getState().openComposer()
    useApp.getState().openComposer()
    expect(useApp.getState().composers).toHaveLength(2)
  })
})
