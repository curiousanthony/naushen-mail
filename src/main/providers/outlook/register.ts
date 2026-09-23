import type { Account } from '@shared/types'
import type { Repo } from '../../db/repo'
import { connectors } from '../../accounts'
import { deleteTokens, loadTokens, saveTokens } from '../../auth/tokens'
import { OutlookAdapter } from './adapter'
import { MISSING_CLIENT_ID, createTokenSource, fetchPhoto, fetchProfile, signIn } from './auth'

let repoRef: Repo | null = null

export const outlookAccountId = (email: string): string => 'outlook-' + email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function buildAdapter(account: Pick<Account, 'id' | 'email' | 'name'>, repo: Repo): OutlookAdapter {
  const tokens = createTokenSource({
    getTokens: () => loadTokens(repo, account.id),
    saveTokens: (t) => saveTokens(repo, account.id, t),
    getClientId: () => repo.getSettings().oauth.microsoftClientId,
    markReauthNeeded: (message) => repo.patchAccount(account.id, { status: 'reauth', statusMessage: message })
  })
  return new OutlookAdapter({
    account, tokens,
    // Graph's delta feed reports removed messages by id only; the local store knows which thread they belonged to.
    lookupConversation: (remoteMessageId) => {
      const row = repo.db.prepare('SELECT t.remote_id AS conv FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.account_id = ? AND m.remote_id = ?')
        .get(account.id, remoteMessageId) as { conv?: string } | undefined
      return row?.conv
    }
  })
}

connectors.outlook = {
  async connect({ repo }) {
    repoRef = repo
    const clientId = repo.getSettings().oauth.microsoftClientId.trim()
    if (!clientId) throw new Error(MISSING_CLIENT_ID)
    const tokens = await signIn(clientId)
    const { email, name } = await fetchProfile(tokens.accessToken)
    const avatarUrl = await fetchPhoto(tokens.accessToken)
    const account: Account = {
      id: outlookAccountId(email), provider: 'outlook', email, name, color: '', avatarUrl, createdAt: Date.now(),
      syncCursor: null, lastSyncAt: null, status: 'ok'
    }
    saveTokens(repo, account.id, tokens)
    return { account, adapter: buildAdapter(account, repo) }
  },
  restore(account, { repo }) {
    repoRef = repo
    return buildAdapter(account, repo)
  },
  forget(account) {
    if (repoRef) deleteTokens(repoRef, account.id)
  }
}
