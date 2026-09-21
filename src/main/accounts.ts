import { randomUUID } from 'node:crypto'
import type { Account, ProviderKind } from '@shared/types'
import type { Repo } from './db/repo'
import type { SyncEngine } from './sync/engine'
import { MockAdapter } from './providers/mock/adapter'

const COLORS = ['#2383e2', '#d9730d', '#0f7b6c', '#9065b0', '#e03e3e', '#ad1a72']

/**
 * Account lifecycle. Real providers plug in via `connectors` — feature branches
 * (feat/provider-gmail, feat/provider-outlook) register their OAuth+adapter factories here.
 */
export interface Connector {
  /** Runs the OAuth flow, persists tokens, returns the new (unsaved) account and its adapter. */
  connect(deps: { repo: Repo }): Promise<{ account: Account; adapter: import('./providers/types').ProviderAdapter }>
  /** Rebuilds an adapter for an existing account at app start. */
  restore(account: Account, deps: { repo: Repo }): import('./providers/types').ProviderAdapter | null
  /** Called when the account is removed (delete stored tokens). */
  forget?(account: Account): void
}

export const connectors: Partial<Record<ProviderKind, Connector>> = {}

let mockCount = 0

export async function connectAccount(kind: ProviderKind, repo: Repo, engine: SyncEngine): Promise<Account> {
  if (kind === 'mock') {
    const flavor = mockCount++ % 2 === 0 ? 'personal' : 'work'
    const id = `mock-${randomUUID().slice(0, 8)}`
    const email = flavor === 'personal' ? 'anthony@gmail.example' : 'anthony@acme.example'
    const account: Account = {
      id, provider: 'mock', email, name: 'Anthony', color: COLORS[repo.listAccounts().length % COLORS.length],
      createdAt: Date.now(), syncCursor: null, lastSyncAt: null, status: 'ok'
    }
    repo.upsertAccount(account)
    engine.register(new MockAdapter(id, email, 'Anthony', flavor))
    await engine.syncAccount(id)
    return repo.getAccount(id)!
  }
  const connector = connectors[kind]
  if (!connector) throw new Error(`The ${kind} connector is not available in this build.`)
  const { account, adapter } = await connector.connect({ repo })
  const acc = { ...account, color: account.color || COLORS[repo.listAccounts().length % COLORS.length] }
  repo.upsertAccount(acc)
  engine.register(adapter)
  await engine.syncAccount(acc.id)
  return repo.getAccount(acc.id)!
}

export function restoreAccounts(repo: Repo, engine: SyncEngine): void {
  for (const a of repo.listAccounts()) {
    if (a.provider === 'mock') {
      // Mock data lives in memory: re-seed on launch by resetting the cursor.
      const flavor = a.email.includes('acme') ? 'work' : 'personal'
      repo.patchAccount(a.id, { syncCursor: null })
      engine.register(new MockAdapter(a.id, a.email, a.name, flavor))
      continue
    }
    const adapter = connectors[a.provider]?.restore(a, { repo })
    if (adapter) engine.register(adapter)
    else repo.patchAccount(a.id, { status: 'error', statusMessage: 'Provider not available' })
  }
}

export function removeAccount(id: string, repo: Repo, engine: SyncEngine): void {
  const a = repo.getAccount(id)
  engine.unregister(id)
  if (a) connectors[a.provider]?.forget?.(a)
  repo.deleteAccount(id)
}
