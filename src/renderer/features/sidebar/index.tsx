import { useApp } from '@/lib/store'
// STUB — owned by feat/ui-shell. Replace with the real Notion-style sidebar.
export function Sidebar(): JSX.Element {
  const { accounts, setNav, setOverlay } = useApp()
  return (
    <aside style={{ background: 'var(--c-bg-sidebar)', padding: 12, paddingTop: 44 }} className="drag">
      <div className="no-drag">
        {accounts.map((a) => <div key={a.id}>{a.email}</div>)}
        <button onClick={() => setNav({ kind: 'role', role: 'inbox' })}>Inbox</button>{' '}
        <button onClick={() => void window.api.invoke('accounts.connect', 'mock').then(() => useApp.getState().init())}>+ Demo account</button>{' '}
        <button onClick={() => setOverlay('settings')}>Settings</button>
      </div>
    </aside>
  )
}
