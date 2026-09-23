import { createHash } from 'node:crypto'
import type { Account } from '@shared/types'
import { connectors, type Connector } from '../../accounts'
import { loopbackAuth, pkce } from '../../auth/oauth'
import { deleteTokens, loadTokens, saveTokens } from '../../auth/tokens'
import type { Repo } from '../../db/repo'
import type { AdapterFactoryDeps } from '../types'
import { GmailAdapter } from './adapter'
import {
  accountIdFor, buildAuthUrl, exchangeCode, fetchUserInfo, GMAIL_MODIFY_SCOPE, MISSING_CLIENT_MESSAGE, revokeToken
} from './auth'

/** `Connector.forget(account)` is not handed a repo, so remember the one used by connect()/restore(). */
let repoRef: Repo | null = null

function makeAdapter(repo: Repo, account: Account): GmailAdapter {
  repoRef = repo
  const deps: AdapterFactoryDeps = {
    account,
    getTokens: () => loadTokens(repo, account.id),
    saveTokens: (t) => saveTokens(repo, account.id, t),
    getSettings: () => repo.getSettings(),
    markReauthNeeded: (message) => repo.patchAccount(account.id, { status: 'reauth', statusMessage: message })
  }
  return new GmailAdapter(deps)
}

export const gmailConnector: Connector = {
  async connect({ repo }) {
    const { googleClientId, googleClientSecret } = repo.getSettings().oauth
    if (!googleClientId.trim() || !googleClientSecret.trim()) throw new Error(MISSING_CLIENT_MESSAGE)
    const client = { clientId: googleClientId.trim(), clientSecret: googleClientSecret.trim() }

    const { verifier, challenge } = pkce()
    const { code, redirectUri } = await loopbackAuth((redirect, state) => buildAuthUrl(client, redirect, state, challenge), { host: '127.0.0.1' })
    const tokens = await exchangeCode(client, code, verifier, redirectUri)
    if (!tokens.refreshToken) {
      throw new Error('Google did not issue a refresh token. Remove Mailroom at myaccount.google.com/permissions and try again.')
    }
    if (!(tokens.scope ?? '').split(' ').includes(GMAIL_MODIFY_SCOPE)) {
      throw new Error('Mailroom needs permission to read and manage your Gmail. Connect again and leave every permission ticked.')
    }
    const me = await fetchUserInfo(tokens.accessToken)

    const account: Account = {
      id: accountIdFor(me.email, (s) => createHash('sha1').update(s).digest('hex')),
      provider: 'gmail',
      email: me.email,
      name: me.name || me.email.split('@')[0],
      color: '',
      createdAt: Date.now(),
      syncCursor: null,
      lastSyncAt: null,
      status: 'ok'
    }
    saveTokens(repo, account.id, tokens)
    return { account, adapter: makeAdapter(repo, account) }
  },

  restore(account, { repo }) {
    return makeAdapter(repo, account)
  },

  forget(account) {
    const repo = repoRef
    if (!repo) return
    const tokens = loadTokens(repo, account.id)
    deleteTokens(repo, account.id)
    // Best effort: also revoke the grant at Google so the app disappears from myaccount.google.com/permissions.
    if (tokens?.refreshToken) void revokeToken(tokens.refreshToken).catch(() => undefined)
  }
}

connectors.gmail = gmailConnector
