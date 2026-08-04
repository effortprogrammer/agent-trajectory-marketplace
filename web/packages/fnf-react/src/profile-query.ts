import type { ProfileClient, ProfileCredits, ProfileCreditsOptions, ProfileSnapshot, ProfileUser, ProfileWorkspace, ProfileWorkspaceWallet } from '@higgsfield/fnf/profile'
import type { QueryClient } from '@tanstack/react-query'
import type { FnfScopeOptions } from './keys'
import { queryOptions } from '@tanstack/react-query'
import { fnfKeys } from './keys'

export interface ProfileQueryClient {
  getUser: () => Promise<ProfileUser | null>
  listWorkspaces: () => Promise<ProfileWorkspace[]>
  getCurrentWorkspace: () => Promise<ProfileWorkspace | null>
  getWallet: () => Promise<ProfileWorkspaceWallet | null>
  getCredits: (options?: ProfileCreditsOptions) => Promise<ProfileCredits | null>
  getSnapshot: (options?: ProfileCreditsOptions) => Promise<ProfileSnapshot>
}

export type ProfileQueryOptions = FnfScopeOptions
export type ProfileCreditsQueryOptions = ProfileCreditsOptions & FnfScopeOptions

export function profileSnapshotQueryOptions(client: ProfileQueryClient, opts?: ProfileCreditsQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.profileSnapshot(opts),
    queryFn: () => client.getSnapshot(opts),
  })
}

export function profileUserQueryOptions(client: Pick<ProfileQueryClient, 'getUser'>, opts?: ProfileQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.profileUser(opts),
    queryFn: () => client.getUser(),
  })
}

export function profileWorkspacesQueryOptions(client: Pick<ProfileQueryClient, 'listWorkspaces'>, opts?: ProfileQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.profileWorkspaces(opts),
    queryFn: () => client.listWorkspaces(),
  })
}

export function profileCurrentWorkspaceQueryOptions(client: Pick<ProfileQueryClient, 'getCurrentWorkspace'>, opts?: ProfileQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.profileCurrentWorkspace(opts),
    queryFn: () => client.getCurrentWorkspace(),
  })
}

export function profileWalletQueryOptions(client: Pick<ProfileQueryClient, 'getWallet'>, opts?: ProfileQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.profileWallet(opts),
    queryFn: () => client.getWallet(),
  })
}

export function profileCreditsQueryOptions(client: Pick<ProfileQueryClient, 'getCredits'>, opts?: ProfileCreditsQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.profileCredits(opts),
    queryFn: () => client.getCredits(opts),
  })
}

export function setProfileSnapshot(queryClient: QueryClient, snapshot: ProfileSnapshot, opts?: FnfScopeOptions): void {
  queryClient.setQueryData<ProfileSnapshot>(fnfKeys.profileSnapshot(opts), snapshot)
  queryClient.setQueryData<ProfileUser | null>(fnfKeys.profileUser(opts), snapshot.user)
  queryClient.setQueryData<ProfileWorkspace[]>(fnfKeys.profileWorkspaces(opts), snapshot.workspaces)
  queryClient.setQueryData<ProfileWorkspace | null>(fnfKeys.profileCurrentWorkspace(opts), snapshot.currentWorkspace)
  queryClient.setQueryData<ProfileWorkspaceWallet | null>(fnfKeys.profileWallet(opts), snapshot.wallet)
  queryClient.setQueryData<ProfileCredits | null>(fnfKeys.profileCredits(opts), snapshot.credits)
}

export type { ProfileClient }
