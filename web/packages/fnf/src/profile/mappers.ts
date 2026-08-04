import type { ProfileUser, ProfileWorkspace, ProfileWorkspaceRole, ProfileWorkspaceType, ProfileWorkspaceWallet } from './types'

type UnknownRecord = Record<string, unknown>

export function mapProfileUser(raw: unknown): ProfileUser | null {
  if (!isRecord(raw))
    return null

  return {
    id: str(raw.id) ?? '',
    email: nullableStr(raw.email),
    businessEmail: nullableStr(raw.business_email ?? raw.businessEmail),
    verifiedBusinessEmail: nullableStr(raw.verified_business_email ?? raw.verifiedBusinessEmail),
    workspaceId: nullableStr(raw.workspace_id ?? raw.workspaceId),
    workspaceType: workspaceType(raw.workspace_type ?? raw.workspaceType),
    workspaceRole: workspaceRole(raw.workspace_role ?? raw.workspaceRole),
    workspaceMembershipExists: bool(raw.workspace_membership_exists ?? raw.workspaceMembershipExists, false),
    planType: nullableStr(raw.plan_type ?? raw.planType),
    billingPeriod: nullableStr(raw.billing_period ?? raw.billingPeriod),
    planEndsAt: raw.plan_ends_at ?? raw.planEndsAt ?? null,
    planVersion: nullableNum(raw.plan_version ?? raw.planVersion),
    credits: num(raw.credits, 0),
    totalPlanCredits: num(raw.total_plan_credits ?? raw.totalPlanCredits, 0),
    packageCredits: num(raw.package_credits ?? raw.packageCredits, 0),
    subscriptionCredits: num(raw.subscription_credits ?? raw.subscriptionCredits, 0),
    nextCreditAllocationAt: nullableStr(raw.next_credit_allocation_at ?? raw.nextCreditAllocationAt),
    dailyCredits: nullableNum(raw.daily_credits ?? raw.dailyCredits),
    text2keyframesCredits: nullableNum(raw.text2keyframes_credits ?? raw.text2keyframesCredits),
    faceSwapCredits: num(raw.face_swap_credits ?? raw.faceSwapCredits, 0),
    characterSwapCredits: num(raw.character_swap_credits ?? raw.characterSwapCredits, 0),
    soulCredits: num(raw.soul_credits ?? raw.soulCredits, 0),
    wan25VideoCredits: nullableNum(raw.wan2_5_video_credits ?? raw.wan25VideoCredits),
    qwenCameraControlCredits: nullableNum(raw.qwen_camera_control_credits ?? raw.qwenCameraControlCredits),
    cohort: nullableStr(raw.cohort),
    promoState: nullableStr(raw.promo_state ?? raw.promoState),
    purchasedPaidBoards: bool(raw.purchased_paid_boards ?? raw.purchasedPaidBoards, false),
    hasUnlim: bool(raw.has_unlim ?? raw.hasUnlim, false),
    hasFlexUnlim: bool(raw.has_flex_unlim ?? raw.hasFlexUnlim, false),
    autoPublish: bool(raw.auto_publish ?? raw.autoPublish, false),
    veo3FastGenerationsCount: num(raw.veo3_fast_generations_count ?? raw.veo3FastGenerationsCount, 0),
    isProPlanVeo3Available: nullableBool(raw.is_pro_plan_veo3_available ?? raw.isProPlanVeo3Available),
    hideReducedNanoBanana2Concurrent: bool(raw.hide_reduced_nano_banana_2_concurrent ?? raw.hideReducedNanoBanana2Concurrent, false),
    isCancelInited: bool(raw.is_cancel_inited ?? raw.isCancelInited, false),
    isPauseScheduled: bool(raw.is_pause_scheduled ?? raw.isPauseScheduled, false),
    isPaused: bool(raw.is_paused ?? raw.isPaused, false),
    pauseResumesAt: nullableStr(raw.pause_resumes_at ?? raw.pauseResumesAt),
    pauseStartsAt: nullableStr(raw.pause_starts_at ?? raw.pauseStartsAt),
    subscriptionDowngradesAt: nullableStr(raw.subscription_downgrades_at ?? raw.subscriptionDowngradesAt),
    lastDailyCreditsAwardedAt: nullableStr(raw.last_daily_credits_awarded_at ?? raw.lastDailyCreditsAwardedAt),
    appealAppliedAt: nullableStr(raw.appeal_applied_at ?? raw.appealAppliedAt),
    suspendedAt: nullableStr(raw.suspended_at ?? raw.suspendedAt),
    blockedAt: nullableStr(raw.blocked_at ?? raw.blockedAt),
    blockReason: nullableStr(raw.block_reason ?? raw.blockReason),
    isGiftSubscription: bool(raw.is_gift_subscription ?? raw.isGiftSubscription, false),
    showGenerationActivityNotice: nullableBool(raw.show_generation_activity_notice ?? raw.showGenerationActivityNotice),
    isTestUser: bool(raw.is_test_user ?? raw.isTestUser, false),
  }
}

export function mapProfileWorkspace(raw: unknown): ProfileWorkspace | null {
  if (!isRecord(raw))
    return null

  const role = workspaceRole(raw.user_role ?? raw.role ?? raw.workspace_role ?? raw.workspaceRole)
  const type = workspaceType(raw.type) ?? 'private'
  const rawBlock = raw.sub_workspace_block ?? raw.subWorkspaceBlock
  const block = isRecord(rawBlock) ? rawBlock : null

  return {
    id: str(raw.id) ?? '',
    name: str(raw.name) ?? '',
    clerkOrganizationId: nullableStr(raw.clerk_organization_id ?? raw.clerkOrganizationId),
    type,
    role,
    isOwner: bool(raw.isOwner ?? raw.is_owner, role === 'owner'),
    isAdmin: bool(raw.isAdmin ?? raw.is_admin, role === 'admin'),
    isMember: bool(raw.isMember ?? raw.is_member, role === 'member'),
    isTeamWorkspace: bool(raw.isTeamWorkspace ?? raw.is_team_workspace, type === 'shared'),
    avatarUrl: nullableStr(raw.avatar_url ?? raw.avatarUrl),
    description: nullableStr(raw.bio ?? raw.description),
    gracePeriodType: gracePeriodType(raw.grace_period_type ?? raw.gracePeriodType),
    ssoStatus: nullableStr(raw.sso_status ?? raw.ssoStatus),
    isEnterpriseSubWorkspace: bool(raw.is_enterprise_sub_workspace ?? raw.isEnterpriseSubWorkspace, false),
    subWorkspaceBlock: block
      ? {
          reason: str(block.reason) ?? 'unknown',
          ownerEmail: nullableStr(block.owner_email ?? block.ownerEmail),
        }
      : null,
  }
}

export function mapProfileWorkspaces(raw: unknown): ProfileWorkspace[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.workspaces)
      ? raw.workspaces
      : isRecord(raw) && Array.isArray(raw.items)
        ? raw.items
        : []

  return items
    .map(item => mapProfileWorkspace(item))
    .filter((item): item is ProfileWorkspace => item !== null)
}

export function mapProfileWallet(raw: unknown): ProfileWorkspaceWallet | null {
  if (!isRecord(raw))
    return null

  return {
    id: str(raw.workspace_id ?? raw.workspaceId ?? raw.id) ?? '',
    subscriptionBalance: num(raw.subscription_balance ?? raw.subscriptionBalance, 0),
    subscriptionTotal: num(raw.total_credits ?? raw.subscription_total ?? raw.subscriptionTotal, 0),
    creditsBalance: num(raw.credits_balance ?? raw.creditsBalance, 0),
    onDemandCredits: Math.max(0, num(raw.on_demand_credits ?? raw.onDemandCredits, 0)),
    walletCreatedAt: nullableStr(raw.wallet_created_at ?? raw.walletCreatedAt),
    nextPaymentDate: nullableStr(raw.next_credit_allocation_date ?? raw.nextPaymentDate),
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function nullableBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function workspaceType(value: unknown): ProfileWorkspaceType | null {
  return value === 'private' || value === 'shared' ? value : null
}

function workspaceRole(value: unknown): ProfileWorkspaceRole | null {
  return value === 'owner' || value === 'admin' || value === 'member' ? value : null
}

function gracePeriodType(value: unknown): 'soft' | 'strict' | null {
  return value === 'soft' || value === 'strict' ? value : null
}
