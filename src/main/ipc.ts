import { dialog, ipcMain, shell, app, BrowserWindow, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MailApi } from '@shared/api'
import { API_METHODS } from '@shared/api'
import type { Repo } from './db/repo'
import type { SyncEngine } from './sync/engine'
import type { Outbox } from './sync/outbox'
import { connectAccount, removeAccount } from './accounts'

export function registerIpc(repo: Repo, engine: SyncEngine, outbox: Outbox): void {
  const impl: MailApi = {
    'accounts.list': async () => repo.listAccounts(),
    'accounts.connect': (kind) => connectAccount(kind, repo, engine),
    'accounts.remove': async (id) => { removeAccount(id, repo, engine); engine.emit({ type: 'changed' }) },

    'labels.list': async () => repo.listLabels(),
    'labels.create': async (accountId, name, color) => {
      const adapter = engine.getAdapter(accountId)
      if (!adapter) throw new Error('Account not connected')
      const l = await adapter.createLabel(name, color)
      repo.upsertLabel({ ...l, color: (color as never) ?? l.color })
      engine.emit({ type: 'changed', accountId })
      return repo.getLabel(l.id)!
    },
    'labels.update': async (id, patch) => {
      const l = repo.getLabel(id)
      repo.patchLabel(id, patch)
      if (l) await engine.getAdapter(l.accountId)?.updateLabel(l.remoteId, patch).catch(() => undefined)
      engine.emit({ type: 'changed' })
    },
    'labels.delete': async (id) => {
      const l = repo.getLabel(id)
      repo.deleteLabel(id)
      if (l) await engine.getAdapter(l.accountId)?.deleteLabel(l.remoteId).catch(() => undefined)
      engine.emit({ type: 'changed' })
    },
    'views.list': async () => repo.listViews(),
    'views.save': async (v) => repo.saveView(v),
    'views.delete': async (id) => repo.deleteView(id),

    'threads.list': async (q) => repo.listThreads(q),
    'threads.get': async (id) => {
      const t = repo.getThread(id)
      if (t && t.messages.some((m) => m.bodyHtml === null && m.bodyText === null)) {
        // Lazy hydration for providers that sync metadata only.
        const a = engine.getAdapter(t.accountId)
        if (a) { repo.upsertNormalized(await a.fetchThread(t.remoteId)); return repo.getThread(id) }
      }
      return t
    },
    'threads.act': (ids, action) => engine.act(ids, action),
    'threads.counts': async () => repo.counts(),
    'threads.search': async (text, accountIds) => repo.listThreads({ filter: { text, accountIds }, limit: 100 }),
    'attachments.save': async (messageId, attachmentId) => {
      const row = repo.db.prepare('SELECT account_id, remote_id, thread_id, attachments_json FROM messages WHERE id = ?').get(messageId) as
        { account_id: string; remote_id: string; attachments_json: string } | undefined
      if (!row) return null
      const att = (JSON.parse(row.attachments_json) as { id: string; filename: string }[]).find((a) => a.id === attachmentId)
      if (!att) return null
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const res = await (win ? dialog.showSaveDialog(win, { defaultPath: join(app.getPath('downloads'), att.filename) }) : dialog.showSaveDialog({ defaultPath: join(app.getPath('downloads'), att.filename) }))
      if (res.canceled || !res.filePath) return null
      const buf = await engine.getAdapter(row.account_id)!.fetchAttachment(row.remote_id, attachmentId)
      await writeFile(res.filePath, buf)
      return res.filePath
    },
    'messages.inlineImages': async (messageId) => {
      const row = repo.db.prepare('SELECT account_id, remote_id, attachments_json FROM messages WHERE id = ?').get(messageId) as
        { account_id: string; remote_id: string; attachments_json: string } | undefined
      if (!row) return {}
      const attachments = JSON.parse(row.attachments_json) as
        { id: string; mimeType: string; contentId?: string; inline: boolean }[]
      const inlineAtts = attachments.filter((a) => a.inline && a.contentId)
      if (inlineAtts.length === 0) return {}
      const adapter = engine.getAdapter(row.account_id)
      if (!adapter) return {}
      const out: Record<string, string> = {}
      await Promise.all(inlineAtts.map(async (a) => {
        try {
          const buf = await adapter.fetchAttachment(row.remote_id, a.id)
          out[a.contentId!] = `data:${a.mimeType};base64,${buf.toString('base64')}`
        } catch {
          // Leave unresolved — the sanitiser's existing blocked-cid placeholder stands.
        }
      }))
      return out
    },
    'attachments.getText': async (messageId, attachmentId) => {
      const row = repo.db.prepare('SELECT account_id, remote_id FROM messages WHERE id = ?').get(messageId) as
        { account_id: string; remote_id: string } | undefined
      if (!row) return null
      const adapter = engine.getAdapter(row.account_id)
      if (!adapter) return null
      try {
        const buf = await adapter.fetchAttachment(row.remote_id, attachmentId)
        return buf.toString('utf-8')
      } catch {
        return null
      }
    },

    'compose.send': (m) => outbox.sendWithUndo(m),
    'compose.schedule': (m, at) => outbox.schedule(m, at),
    'compose.cancelScheduled': async (id) => outbox.cancel(id),
    'compose.listScheduled': async () => repo.listScheduled(),
    'compose.retry': async (id) => outbox.retry(id),
    'drafts.save': async (d) => repo.saveDraft(d),
    'drafts.list': async () => repo.listDrafts(),
    'drafts.get': async (id) => repo.getDraft(id),
    'drafts.delete': async (id) => repo.deleteDraft(id),
    'contacts.suggest': async (prefix) => repo.suggestContacts(prefix),

    'sync.now': (id) => (id ? engine.syncAccount(id) : engine.syncAll()),
    'settings.get': async () => repo.getSettings(),
    'settings.set': async (patch) => {
      const next = repo.setSettings(patch)
      if (patch.theme) nativeTheme.themeSource = patch.theme
      return next
    },
    'app.openExternal': async (url) => { if (/^(https?:|mailto:)/i.test(url)) await shell.openExternal(url) },
    'app.platform': async () => ({ platform: process.platform, version: app.getVersion() })
  }

  for (const name of API_METHODS) {
    ipcMain.handle(`api:${name}`, (_e, ...args) => (impl[name] as (...a: unknown[]) => unknown)(...args))
  }
}
