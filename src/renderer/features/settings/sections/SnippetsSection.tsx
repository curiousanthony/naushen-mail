import { useEffect, useState } from 'react'
import { Braces, Plus, Trash2 } from 'lucide-react'
import { Button, ConfirmBar, EmptyState, Group, IconButton, Row, SavedTick, SectionTitle, TextInput } from '../ui'
import { RichTextEditor } from './RichTextEditor'
import { useFlash } from '../lib/hooks'
import {
  htmlToPreview, loadSnippets, newSnippetId, normalizeShortcut, saveSnippets, shortcutTaken, upsertSnippet, type Snippet
} from '../lib/snippets'

function SnippetEditor({ snippet, isNew, all, onSave, onCancel, onDelete }: {
  snippet: Snippet; isNew: boolean; all: Snippet[]; onSave: (s: Snippet) => void; onCancel: () => void; onDelete: () => void
}): JSX.Element {
  const [title, setTitle] = useState(snippet.title)
  const [shortcut, setShortcut] = useState(snippet.shortcut ?? '')
  const [html, setHtml] = useState(snippet.html)
  const [confirming, setConfirming] = useState(false)
  const taken = shortcutTaken(all, shortcut, snippet.id)
  const canSave = !taken && (title.trim() !== '' || html !== '')
  const save = (): void => { if (canSave) onSave({ ...snippet, title, shortcut: shortcut ? normalizeShortcut(shortcut) : undefined, html }) }

  return (
    <div className="st-editor" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() } }}>
      <Row label="Title" htmlFor="snip-title" stack><TextInput id="snip-title" autoFocus={isNew} value={title} placeholder="e.g. Meeting availability" onChange={(e) => setTitle(e.target.value)} /></Row>
      <Row label="Shortcut" htmlFor="snip-shortcut" stack description={taken ? undefined : 'Optional. Type the shortcut after “/” in the composer to insert this snippet.'}>
        <div className="st-input-wrap st-input-wrap--prefix">
          <span className="st-input-prefix">/</span>
          <TextInput id="snip-shortcut" value={shortcut} invalid={taken} placeholder="meeting" onChange={(e) => setShortcut(e.target.value)} />
        </div>
        {taken && <div className="st-field__msg is-error">Another snippet already uses /{normalizeShortcut(shortcut)}.</div>}
      </Row>
      <div className="st-editor__body">
        <div className="st-row__label">Content</div>
        <RichTextEditor label="Snippet content" resetKey={snippet.id} initialHtml={snippet.html} placeholder="Write the text to insert…" minHeight={140} onChange={setHtml} />
      </div>
      {confirming && <ConfirmBar confirmLabel="Delete" onCancel={() => setConfirming(false)} onConfirm={onDelete} message={<><strong>Delete this snippet?</strong> This can’t be undone.</>} />}
      <div className="st-editor__actions">
        {!isNew && <Button variant="ghost" className="st-danger-text" onClick={() => setConfirming(true)}>Delete</Button>}
        <span className="st-spacer" />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={save}>{isNew ? 'Create snippet' : 'Save'}</Button>
      </div>
    </div>
  )
}

export function SnippetsSection(): JSX.Element {
  const [list, setList] = useState<Snippet[]>(() => loadSnippets())
  const [editing, setEditing] = useState<{ snippet: Snippet; isNew: boolean } | null>(null)
  const [saved, flash] = useFlash()
  const [failed, setFailed] = useState(false)
  useEffect(() => { setList(loadSnippets()) }, [])

  const commit = (next: Snippet[]): void => {
    setList(next); setFailed(!saveSnippets(next)); flash()
  }

  return (
    <div>
      <SectionTitle title="Snippets" description="Reusable text you can insert into any message. Stored on this Mac." />
      <Group action={<span className="st-group__tools"><SavedTick show={saved} />{!editing && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ snippet: { id: newSnippetId(), title: '', html: '' }, isNew: true })}>New snippet</Button>}</span>}>
        {failed && <div className="st-inline-error" role="alert">Couldn’t save snippets (local storage is unavailable).</div>}
        {editing && (
          <SnippetEditor key={editing.snippet.id} snippet={editing.snippet} isNew={editing.isNew} all={list} onCancel={() => setEditing(null)}
            onSave={(s) => { commit(upsertSnippet(list, s)); setEditing(null) }}
            onDelete={() => { commit(list.filter((x) => x.id !== editing.snippet.id)); setEditing(null) }} />
        )}
        {!editing && list.length === 0 && (
          <EmptyState icon={<Braces size={22} strokeWidth={1.5} />} title="No snippets yet"
            action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ snippet: { id: newSnippetId(), title: '', html: '' }, isNew: true })}>Create a snippet</Button>}>
            Save the things you type again and again: availability, directions, a polite decline.
          </EmptyState>
        )}
        {!editing && list.length > 0 && (
          <ul className="st-snippets">
            {list.map((s) => (
              <li key={s.id} className="st-snippet">
                <button type="button" className="st-snippet__main" onClick={() => setEditing({ snippet: s, isNew: false })}>
                  <span className="st-snippet__title">{s.title || 'Untitled snippet'}{s.shortcut && <code>/{s.shortcut}</code>}</span>
                  <span className="st-snippet__preview">{htmlToPreview(s.html) || 'Empty'}</span>
                </button>
                <IconButton className="st-snippet__del" label={`Delete ${s.title || 'snippet'}`} onClick={() => commit(list.filter((x) => x.id !== s.id))}><Trash2 size={15} strokeWidth={1.5} /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  )
}
