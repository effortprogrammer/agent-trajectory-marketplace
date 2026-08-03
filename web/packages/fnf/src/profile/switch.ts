import type { ProfileContext, ProfileSnapshot, SwitchWorkspaceInput } from './types'
import { ValidationError } from '../errors'
import { observeAsync } from '../observability'
import { getProfileSnapshot } from './get'

export async function switchProfileWorkspace(ctx: ProfileContext, input: SwitchWorkspaceInput): Promise<ProfileSnapshot> {
  return observeAsync(ctx.observability, 'fnf.profile.switch_workspace', { workspace_id: input.workspaceId }, async () => {
    const workspaceId = input.workspaceId.trim()
    if (!workspaceId)
      throw new ValidationError('switchWorkspace requires a non-empty workspaceId')

    await ctx.profileAdapter.switchWorkspace({ workspaceId })
    return getProfileSnapshot(ctx)
  }, {
    successAttributes: snapshot => ({
      has_current_workspace: snapshot.currentWorkspace !== null,
      ...(snapshot.currentWorkspace?.id ? { current_workspace_id: snapshot.currentWorkspace.id } : {}),
    }),
  })
}
