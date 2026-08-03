import { createProfileClient } from '@higgsfield/fnf/profile'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { fnfKeys } from '../keys'
import {
  profileCreditsQueryOptions,
  profileCurrentWorkspaceQueryOptions,
  profileSnapshotQueryOptions,
  profileUserQueryOptions,
  profileWalletQueryOptions,
  profileWorkspacesQueryOptions,
  setProfileSnapshot,
} from '../profile-query'
import { switchWorkspaceMutationOptions } from '../workspace-switch'
import { createMemoryProfileAdapter, gen } from './test-utils'

describe('profile query options', () => {
  it('fetches profile pieces through the SDK profile client into scoped keys', async () => {
    const client = createProfileClient({
      profileAdapter: createMemoryProfileAdapter({
        user: { id: 'u1', workspace_id: 'w1', workspace_type: 'private', workspace_role: 'owner' },
        workspaces: [{ id: 'w1', name: 'Personal', type: 'private', user_role: 'owner' }],
        wallet: { subscription_balance: 500, total_credits: 1000, credits_balance: 200 },
      }),
    })
    const qc = new QueryClient()
    const scope = { scopeKey: 'u1:w1' }

    await expect(qc.fetchQuery(profileUserQueryOptions(client, scope))).resolves.toMatchObject({ id: 'u1', workspaceId: 'w1' })
    await expect(qc.fetchQuery(profileWorkspacesQueryOptions(client, scope))).resolves.toHaveLength(1)
    await expect(qc.fetchQuery(profileCurrentWorkspaceQueryOptions(client, scope))).resolves.toMatchObject({ id: 'w1' })
    await expect(qc.fetchQuery(profileWalletQueryOptions(client, scope))).resolves.toMatchObject({ subscriptionBalance: 500 })
    await expect(qc.fetchQuery(profileCreditsQueryOptions(client, scope))).resolves.toMatchObject({ totalAvailableCredits: 7 })
    await expect(qc.fetchQuery(profileSnapshotQueryOptions(client, scope))).resolves.toMatchObject({ user: { id: 'u1' }, wallet: { id: 'w1' } })

    expect(qc.getQueryData(fnfKeys.profileUser(scope))).toMatchObject({ id: 'u1' })
    expect(qc.getQueryData(fnfKeys.profileUser())).toBeUndefined()
    expect(fnfKeys.profileCredits({ ...scope, includeOnDemand: false })).toEqual(['fnf', 'scope', 'u1:w1', 'profile', 'credits', { includeOnDemand: false }])
    expect(fnfKeys.profileSnapshot({ ...scope, includeOnDemand: false })).toEqual(['fnf', 'scope', 'u1:w1', 'profile', 'snapshot', { includeOnDemand: false }])
  })

  it('writes a composed snapshot into every profile cache leaf', () => {
    const qc = new QueryClient()
    const snapshot = {
      user: { id: 'u1' },
      workspaces: [{ id: 'w1' }],
      currentWorkspace: { id: 'w1' },
      wallet: { id: 'w1' },
      credits: { totalAvailableCredits: 12 },
    } as never

    setProfileSnapshot(qc, snapshot, { scopeKey: 'u1:w1' })

    expect(qc.getQueryData(fnfKeys.profileSnapshot({ scopeKey: 'u1:w1' }))).toBe(snapshot)
    expect(qc.getQueryData(fnfKeys.profileUser({ scopeKey: 'u1:w1' }))).toEqual({ id: 'u1' })
    expect(qc.getQueryData(fnfKeys.profileWorkspaces({ scopeKey: 'u1:w1' }))).toEqual([{ id: 'w1' }])
    expect(qc.getQueryData(fnfKeys.profileCurrentWorkspace({ scopeKey: 'u1:w1' }))).toEqual({ id: 'w1' })
    expect(qc.getQueryData(fnfKeys.profileWallet({ scopeKey: 'u1:w1' }))).toEqual({ id: 'w1' })
    expect(qc.getQueryData(fnfKeys.profileCredits({ scopeKey: 'u1:w1' }))).toEqual({ totalAvailableCredits: 12 })
  })
})

describe('workspace switch mutation options', () => {
  it('switches context, clears old scoped generation caches, writes next profile snapshot, and notifies the host', async () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.job('old', { scopeKey: 'u:w1' }), gen('old', 'queued'))
    qc.setQueryData(fnfKeys.jobs({}, { scopeKey: 'u:w1' }), { pages: [{ items: [gen('old', 'queued')] }], pageParams: [undefined] })
    qc.setQueryData(fnfKeys.realtimeCustomStyles({}, { scopeKey: 'u:w1' }), { items: [{ id: 'old-style' }] })
    qc.setQueryData(fnfKeys.job('new', { scopeKey: 'u:w2' }), gen('new', 'queued'))
    qc.setQueryData(fnfKeys.realtimeCustomStyles({}, { scopeKey: 'u:w2' }), { items: [{ id: 'new-style' }] })
    const onWorkspaceChanged = vi.fn()
    const snapshot = {
      user: { id: 'u', workspaceId: 'w2' },
      workspaces: [],
      currentWorkspace: { id: 'w2' },
      wallet: null,
      credits: null,
    } as never
    const client = {
      switchWorkspace: vi.fn(async () => snapshot),
    }
    const mutation = switchWorkspaceMutationOptions(client, qc, {
      scopeKey: 'u:w1',
      nextScopeKey: snap => `u:${snap.currentWorkspace?.id ?? 'none'}`,
      onWorkspaceChanged,
    })

    const result = await mutation.mutationFn({ workspaceId: 'w2' })
    await mutation.onSuccess(result)

    expect(client.switchWorkspace).toHaveBeenCalledWith({ workspaceId: 'w2' })
    expect(qc.getQueryData(fnfKeys.job('old', { scopeKey: 'u:w1' }))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.jobs({}, { scopeKey: 'u:w1' }))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.realtimeCustomStyles({}, { scopeKey: 'u:w1' }))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.job('new', { scopeKey: 'u:w2' }))).toBeDefined()
    expect(qc.getQueryData(fnfKeys.realtimeCustomStyles({}, { scopeKey: 'u:w2' }))).toBeDefined()
    expect(qc.getQueryData(fnfKeys.profileSnapshot({ scopeKey: 'u:w2' }))).toBe(snapshot)
    expect(onWorkspaceChanged).toHaveBeenCalledWith(snapshot)
  })
})
