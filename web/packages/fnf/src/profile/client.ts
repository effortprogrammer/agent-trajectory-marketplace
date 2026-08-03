import type { ProfileClient, ProfileClientConfig } from './types'
import { createProfileContext } from './context'
import { getCurrentProfileWorkspace, getProfileCredits, getProfileSnapshot, getProfileUser, getProfileWallet, listProfileWorkspaces } from './get'
import { switchProfileWorkspace } from './switch'

/** Compose profile operations into a client. */
export function createProfileClient(config: ProfileClientConfig): ProfileClient {
  const ctx = createProfileContext(config)
  return {
    getUser: () => getProfileUser(ctx),
    listWorkspaces: () => listProfileWorkspaces(ctx),
    getCurrentWorkspace: () => getCurrentProfileWorkspace(ctx),
    getWallet: () => getProfileWallet(ctx),
    getCredits: options => getProfileCredits(ctx, options),
    getSnapshot: options => getProfileSnapshot(ctx, options),
    switchWorkspace: input => switchProfileWorkspace(ctx, input),
  }
}
