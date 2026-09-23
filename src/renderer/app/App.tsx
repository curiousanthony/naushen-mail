import { useEffect } from 'react'
import { useApp } from '@/lib/store'
import { Sidebar } from '@/features/sidebar'
import { ThreadList } from '@/features/threadlist'
import { Reader } from '@/features/reader'
import { ComposeHost } from '@/features/compose'
import { SettingsModal } from '@/features/settings'
import { CommandPalette, Toaster, ShortcutsHelp, useGlobalShortcuts } from '@/features/commands'
import { TooltipHost } from '@/features/tooltip'

/**
 * Shell composition only. Each region is owned by a feature folder (see docs/04-workstreams.md);
 * this file should rarely change.
 */
export function App(): JSX.Element {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  useEffect(() => { void init() }, [init])
  useGlobalShortcuts()

  // The OS opened Naushen Mail for a `mailto:` link (Naushen Mail registers the scheme).
  useEffect(() => window.api.onMailto((init) => { useApp.getState().openComposer({ init }) }), [])

  return (
    <div className="app">
      <Sidebar />
      <main className="app__main">
        <div className="titlebar drag" />
        {ready && <ThreadList />}
        <Reader />
      </main>
      <ComposeHost />
      <SettingsModal />
      <CommandPalette />
      <ShortcutsHelp />
      <Toaster />
      <TooltipHost />
    </div>
  )
}
