import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('settings')
  const [title, setTitle] = useState(snippet.title)
  const [shortcut, setShortcut] = useState(snippet.shortcut ?? '')
  const [html, setHtml] = useState(snippet.html)
  const [confirming, setConfirming] = useState(false)
  const taken = shortcutTaken(all, shortcut, snippet.id)
  const canSave = !taken && (title.trim() !== '' || html !== '')
  const save = (): void => { if (canSave) onSave({ ...snippet, title, shortcut: shortcut ? normalizeShortcut(shortcut) : undefined, html }) }

  return (
    <div className="st-editor" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() } }}>
      <Row label={t('snippets.titleLabel')} htmlFor="snip-title" stack><TextInput id="snip-title" autoFocus={isNew} value={title} placeholder={t('snippets.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} /></Row>
      <Row label={t('snippets.shortcutLabel')} htmlFor="snip-shortcut" stack description={taken ? undefined : t('snippets.shortcutHint')}>
        <div className="st-input-wrap st-input-wrap--prefix">
          <span className="st-input-prefix">/</span>
          <TextInput id="snip-shortcut" value={shortcut} invalid={taken} placeholder={t('snippets.shortcutPlaceholder')} onChange={(e) => setShortcut(e.target.value)} />
        </div>
        {taken && <div className="st-field__msg is-error">{t('snippets.shortcutTaken', { shortcut: normalizeShortcut(shortcut) })}</div>}
      </Row>
      <div className="st-editor__body">
        <div className="st-row__label">{t('snippets.content')}</div>
        <RichTextEditor label={t('snippets.contentLabel')} resetKey={snippet.id} initialHtml={snippet.html} placeholder={t('snippets.contentPlaceholder')} minHeight={140} onChange={setHtml} />
      </div>
      {confirming && <ConfirmBar confirmLabel={t('snippets.delete')} onCancel={() => setConfirming(false)} onConfirm={onDelete} message={<Trans t={t} i18nKey="snippets.deleteConfirm" components={{ b: <strong /> }} />} />}
      <div className="st-editor__actions">
        {!isNew && <Button variant="ghost" className="st-danger-text" onClick={() => setConfirming(true)}>{t('snippets.delete')}</Button>}
        <span className="st-spacer" />
        <Button onClick={onCancel}>{t('ui.cancel')}</Button>
        <Button variant="primary" disabled={!canSave} onClick={save}>{isNew ? t('snippets.create') : t('snippets.save')}</Button>
      </div>
    </div>
  )
}

export function SnippetsSection(): JSX.Element {
  const { t } = useTranslation('settings')
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
      <SectionTitle title={t('snippets.title')} description={t('snippets.description')} />
      <Group action={<span className="st-group__tools"><SavedTick show={saved} />{!editing && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ snippet: { id: newSnippetId(), title: '', html: '' }, isNew: true })}>{t('snippets.new')}</Button>}</span>}>
        {failed && <div className="st-inline-error" role="alert">{t('snippets.saveFailed')}</div>}
        {editing && (
          <SnippetEditor key={editing.snippet.id} snippet={editing.snippet} isNew={editing.isNew} all={list} onCancel={() => setEditing(null)}
            onSave={(s) => { commit(upsertSnippet(list, s)); setEditing(null) }}
            onDelete={() => { commit(list.filter((x) => x.id !== editing.snippet.id)); setEditing(null) }} />
        )}
        {!editing && list.length === 0 && (
          <EmptyState icon={<Braces size={22} strokeWidth={1.5} />} title={t('snippets.empty.title')}
            action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ snippet: { id: newSnippetId(), title: '', html: '' }, isNew: true })}>{t('snippets.empty.create')}</Button>}>
            {t('snippets.empty.body')}
          </EmptyState>
        )}
        {!editing && list.length > 0 && (
          <ul className="st-snippets">
            {list.map((s) => (
              <li key={s.id} className="st-snippet">
                <button type="button" className="st-snippet__main" onClick={() => setEditing({ snippet: s, isNew: false })}>
                  <span className="st-snippet__title">{s.title || t('snippets.untitled')}{s.shortcut && <code>/{s.shortcut}</code>}</span>
                  <span className="st-snippet__preview">{htmlToPreview(s.html) || t('snippets.emptyPreview')}</span>
                </button>
                <IconButton className="st-snippet__del" label={t('snippets.deleteNamed', { name: s.title || t('snippets.snippetFallback') })} onClick={() => commit(list.filter((x) => x.id !== s.id))}><Trash2 size={15} strokeWidth={1.5} /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  )
}
