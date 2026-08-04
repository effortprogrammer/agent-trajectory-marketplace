'use client'

import type { ProfileSnapshot, SwitchWorkspaceInput } from '@higgsfield/fnf/profile'
import type { QueryClient } from '@tanstack/react-query'
import type { FnfScopeOptions } from './keys'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { removeGenerationQueries } from './generation-cache'
import { fnfKeys } from './keys'
import { setProfileSnapshot } from './profile-query'
import { useFnfProfileClient, useFnfScopeKey } from './provider'

export interface SwitchWorkspaceClient {
  switchWorkspace: (input: SwitchWorkspaceInput) => Promise<ProfileSnapshot>
}

export interface SwitchWorkspaceMutationConfig extends FnfScopeOptions {
  nextScopeKey?: (snapshot: ProfileSnapshot) => string | undefined
  onWorkspaceChanged?: (snapshot: ProfileSnapshot) => void | Promise<void>
}

export function switchWorkspaceMutationOptions(
  client: SwitchWorkspaceClient,
  queryClient: QueryClient,
  opts: SwitchWorkspaceMutationConfig = {},
) {
  return {
    mutationFn: (input: SwitchWorkspaceInput) => client.switchWorkspace(input),
    onSuccess: async (snapshot: ProfileSnapshot) => {
      removeGenerationQueries(queryClient, opts)
      queryClient.removeQueries({ queryKey: fnfKeys.realtime(opts) })
      const nextScopeKey = opts.nextScopeKey?.(snapshot) ?? opts.scopeKey
      if (opts.scopeKey && opts.scopeKey !== nextScopeKey)
        queryClient.removeQueries({ queryKey: fnfKeys.profile({ scopeKey: opts.scopeKey }) })
      setProfileSnapshot(queryClient, snapshot, nextScopeKey ? { scopeKey: nextScopeKey } : undefined)
      await opts.onWorkspaceChanged?.(snapshot)
    },
  }
}

export function useSwitchWorkspaceMutation(opts: SwitchWorkspaceMutationConfig = {}) {
  const client = useFnfProfileClient()
  const queryClient = useQueryClient()
  const providerScopeKey = useFnfScopeKey()
  return useMutation(
    switchWorkspaceMutationOptions(client, queryClient, {
      ...opts,
      scopeKey: opts.scopeKey ?? providerScopeKey,
    }),
  )
}
