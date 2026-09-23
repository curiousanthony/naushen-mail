// Focused unit tests for the `messages.inlineImages` IPC handler (main/ipc.ts). No real
// network/Electron: `electron` is stubbed, and the "adapter" is a fake with `fetchAttachment`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0' },
  BrowserWindow: { getFocusedWindow: () => undefined },
  nativeTheme: { themeSource: 'system' }
}))

import { ipcMain } from 'electron'
import { registerIpc } from '../../src/main/ipc'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import type { NormalizedThread } from '../../src/main/providers/types'
import type { Account, Attachment, Message } from '../../src/shared/types'

type Handler = (event: unknown, ...args: unknown[]) => unknown

/** Pulls the handler `registerIpc` registered for one API method off the mocked `ipcMain.handle`. */
function handlerFor(name: string): Handler {
  const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
  const call = calls.find((c) => c[0] === `api:${name}`)
  if (!call) throw new Error(`handler not registered: ${name}`)
  return call[1] as Handler
}

const attachment = (over: Partial<Attachment>): Attachment => ({
  id: 'att1', filename: 'logo.png', mimeType: 'image/png', size: 10, inline: true, ...over
})

const msg = (over: Partial<Message>): Message => ({
  id: 'm1', threadId: 't1', accountId: 'a1', remoteId: 'rm1',
  from: { email: 'sender@x.test' }, to: [], cc: [], bcc: [],
  subject: 's', date: 1, snippet: '', bodyHtml: '<img src="cid:logo123">', bodyText: null,
  attachments: [attachment({ contentId: 'logo123' })], unread: false, labelIds: [], isDraft: false,
  ...over
})

/** Wraps a single message in the minimal thread shell `Repo.upsertNormalized` expects. */
function threadOf(m: Message): NormalizedThread {
  return {
    thread: {
      id: m.threadId, accountId: m.accountId, remoteId: 't-remote', subject: m.subject, snippet: m.snippet,
      lastMessageAt: m.date, messageCount: 1, unread: m.unread, starred: false, hasAttachments: true,
      labelIds: [], participants: []
    },
    messages: [m]
  }
}

describe('messages.inlineImages', () => {
  let repo: Repo

  const account: Account = {
    id: 'a1', provider: 'gmail', email: 'a1@x.test', name: 'a1', color: '#000',
    createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok'
  }

  beforeEach(() => {
    (ipcMain.handle as unknown as { mockClear(): void }).mockClear()
    repo = new Repo(openDb(':memory:'))
    repo.upsertAccount(account)
  })

  it('resolves an inline attachment to a data: URL keyed by its Content-ID', async () => {
    repo.upsertNormalized(threadOf(msg({})))
    const fetchAttachment = vi.fn(async (remoteMessageId: string, attachmentId: string) => {
      expect(remoteMessageId).toBe('rm1')
      expect(attachmentId).toBe('att1')
      return Buffer.from('PNGDATA')
    })
    registerIpc(repo, { getAdapter: () => ({ fetchAttachment }) } as never, {} as never)

    const result = await handlerFor('messages.inlineImages')(undefined, 'm1')

    expect(result).toEqual({ logo123: `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}` })
  })

  it('ignores attachments that are not inline, or have no Content-ID', async () => {
    repo.upsertNormalized(threadOf(msg({
      attachments: [
        attachment({ id: 'no-cid', contentId: undefined }),
        attachment({ id: 'not-inline', inline: false, contentId: 'has-cid' })
      ]
    })))
    const fetchAttachment = vi.fn()
    registerIpc(repo, { getAdapter: () => ({ fetchAttachment }) } as never, {} as never)

    const result = await handlerFor('messages.inlineImages')(undefined, 'm1')

    expect(result).toEqual({})
    expect(fetchAttachment).not.toHaveBeenCalled()
  })

  it('leaves a failed fetch unresolved instead of throwing', async () => {
    repo.upsertNormalized(threadOf(msg({})))
    const fetchAttachment = vi.fn(async () => { throw new Error('network down') })
    registerIpc(repo, { getAdapter: () => ({ fetchAttachment }) } as never, {} as never)

    await expect(handlerFor('messages.inlineImages')(undefined, 'm1')).resolves.toEqual({})
  })

  it('returns {} for an unknown message id and for a disconnected account', async () => {
    repo.upsertNormalized(threadOf(msg({})))
    registerIpc(repo, { getAdapter: () => undefined } as never, {} as never)
    const handler = handlerFor('messages.inlineImages')

    await expect(handler(undefined, 'does-not-exist')).resolves.toEqual({})
    await expect(handler(undefined, 'm1')).resolves.toEqual({})
  })
})
