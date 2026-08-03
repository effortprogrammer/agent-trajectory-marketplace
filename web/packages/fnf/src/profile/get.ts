import type { ProfileContext, ProfileCredits, ProfileCreditsOptions, ProfileSnapshot, ProfileUser, ProfileWorkspace, ProfileWorkspaceWallet } from './types'
import { observeAsync } from '../observability'
import { calculateProfileCredits } from './credits'
import { mapProfileUser, mapProfileWallet, mapProfileWorkspace, mapProfileWorkspaces } from './mappers'

export async function getProfileUser(ctx: ProfileContext): Promise<ProfileUser | null> {
  return observeAsync(ctx.observability, 'fnf.profile.get_user', {}, async () => mapProfileUser(await ctx.profileAdapter.getUser()), {
    successAttributes: user => ({ has_user: user !== null, ...(user?.id ? { user_id: user.id } : {}) }),
  })
}

export async function listProfileWorkspaces(ctx: ProfileContext): Promise<ProfileWorkspace[]> {
  return observeAsync(ctx.observability, 'fnf.profile.list_workspaces', {}, async () => mapProfileWorkspaces(await ctx.profileAdapter.listWorkspaces()), {
    successAttributes: workspaces => ({ workspace_count: workspaces.length }),
  })
}

export async function getCurrentProfileWorkspace(ctx: ProfileContext): Promise<ProfileWorkspace | null> {
  return observeAsync(ctx.observability, 'fnf.profile.get_current_workspace', {}, async () => mapProfileWorkspace(await ctx.profileAdapter.getCurrentWorkspace()), {
    successAttributes: workspace => ({ has_workspace: workspace !== null, ...(workspace?.id ? { workspace_id: workspace.id } : {}) }),
  })
}

export async function getProfileWallet(ctx: ProfileContext): Promise<ProfileWorkspaceWallet | null> {
  return observeAsync(ctx.observability, 'fnf.profile.get_wallet', {}, async () => mapProfileWallet(await ctx.profileAdapter.getWorkspaceWallet()), {
    successAttributes: wallet => ({ has_wallet: wallet !== null }),
  })
}

export async function getProfileCredits(ctx: ProfileContext, options?: ProfileCreditsOptions): Promise<ProfileCredits | null> {
  return observeAsync(ctx.observability, 'fnf.profile.get_credits', { include_on_demand: options?.includeOnDemand !== false }, async () => {
    const wallet = await getProfileWallet(ctx)
    return wallet ? calculateProfileCredits(wallet, options) : null
  }, {
    successAttributes: credits => ({ has_credits: credits !== null }),
  })
}

export async function getProfileSnapshot(ctx: ProfileContext, options?: ProfileCreditsOptions): Promise<ProfileSnapshot> {
  return observeAsync(ctx.observability, 'fnf.profile.get_snapshot', { include_on_demand: options?.includeOnDemand !== false }, async () => {
    const [user, workspaces, currentWorkspace, wallet] = await Promise.all([
      getProfileUser(ctx),
      listProfileWorkspaces(ctx),
      getCurrentProfileWorkspace(ctx),
      getProfileWallet(ctx),
    ])

    return {
      user,
      workspaces,
      currentWorkspace,
      wallet,
      credits: wallet ? calculateProfileCredits(wallet, options) : null,
    }
  }, {
    successAttributes: snapshot => ({
      has_user: snapshot.user !== null,
      workspace_count: snapshot.workspaces.length,
      has_current_workspace: snapshot.currentWorkspace !== null,
      has_wallet: snapshot.wallet !== null,
      has_credits: snapshot.credits !== null,
    }),
  })
}
