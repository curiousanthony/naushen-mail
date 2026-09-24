import { app, nativeImage, type WebContents } from 'electron'
import { mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Repo } from './db/repo'
import type { SyncEngine } from './sync/engine'
import { safeFileName } from './notify-plan'

const dragRoot = (): string => join(app.getPath('temp'), 'naushen-mail-drag')
const inflight = new Map<string, Promise<string | null>>()

/** Fetch the attachment into a temp file (once per message/attachment). */
async function materialise(repo: Repo, engine: SyncEngine, messageId: string, attachmentId: string): Promise<string | null> {
  const key = `${messageId}\u0000${attachmentId}`
  const hit = inflight.get(key)
  if (hit) return hit
  const p = (async () => {
    const row = repo.db.prepare('SELECT account_id, remote_id, attachments_json FROM messages WHERE id = ?').get(messageId) as
      { account_id: string; remote_id: string; attachments_json: string } | undefined
    if (!row) return null
    const att = (JSON.parse(row.attachments_json) as { id: string; filename: string }[]).find((a) => a.id === attachmentId)
    const adapter = engine.getAdapter(row.account_id)
    if (!att || !adapter) return null
    const dir = join(dragRoot(), createHash('sha1').update(key).digest('hex').slice(0, 20))
    const file = join(dir, safeFileName(att.filename))
    try { await stat(file); return file } catch { /* not cached yet */ }
    await mkdir(dir, { recursive: true })
    await writeFile(file, await adapter.fetchAttachment(row.remote_id, attachmentId))
    return file
  })().catch(() => { inflight.delete(key); return null })
  inflight.set(key, p)
  return p
}

/**
 * Begin an OS drag of an attachment (drop into Finder / Desktop / another app). `start: false`
 * only warms the temp file (the renderer calls it on hover) so the real drag starts instantly.
 */
export async function dragOutAttachment(
  repo: Repo, engine: SyncEngine, sender: WebContents | undefined, messageId: string, attachmentId: string, start: boolean
): Promise<boolean> {
  const file = await materialise(repo, engine, messageId, attachmentId)
  if (!file) return false
  if (!start || !sender || sender.isDestroyed()) return true
  let icon = nativeImage.createEmpty()
  try { icon = await app.getFileIcon(file, { size: 'normal' }) } catch { /* fall through */ }
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON)
  sender.startDrag({ file, icon })
  return true
}

export function cleanupDragFiles(): void { void rm(dragRoot(), { recursive: true, force: true }).catch(() => undefined) }

// 1x1 transparent PNG: startDrag rejects an empty icon.
const FALLBACK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
