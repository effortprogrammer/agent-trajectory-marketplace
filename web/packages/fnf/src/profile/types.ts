import type { ProfileBackend } from '../backend'
import type { FnfObservabilityContext, FnfObservabilityOptions } from '../observability'

export type ProfileWorkspaceType = 'private' | 'shared'
export type ProfileWorkspaceRole = 'owner' | 'admin' | 'member'

export interface ProfileUser {
  id: string
  email: string | null
  businessEmail: string | null
  verifiedBusinessEmail: string | null
  workspaceId: string | null
  workspaceType: ProfileWorkspaceType | null
  workspaceRole: ProfileWorkspaceRole | null
  workspaceMembershipExists: boolean
  planType: string | null
  billingPeriod: string | null
  planEndsAt: unknown
  planVersion: number | null
  credits: number
  totalPlanCredits: number
  packageCredits: number
  subscriptionCredits: number
  nextCreditAllocationAt: string | null
  dailyCredits: number | null
  text2keyframesCredits: number | null
  faceSwapCredits: number
  characterSwapCredits: number
  soulCredits: number
  wan25VideoCredits: number | null
  qwenCameraControlCredits: number | null
  cohort: string | null
  promoState: string | null
  purchasedPaidBoards: boolean
  hasUnlim: boolean
  hasFlexUnlim: boolean
  autoPublish: boolean
  veo3FastGenerationsCount: number
  isProPlanVeo3Available: boolean | null
  hideReducedNanoBanana2Concurrent: boolean
  isCancelInited: boolean
  isPauseScheduled: boolean
  isPaused: boolean
  pauseResumesAt: string | null
  pauseStartsAt: string | null
  subscriptionDowngradesAt: string | null
  lastDailyCreditsAwardedAt: string | null
  appealAppliedAt: string | null
  suspendedAt: string | null
  blockedAt: string | null
  blockReason: string | null
  isGiftSubscription: boolean
  showGenerationActivityNotice: boolean | null
  isTestUser: boolean
}

export interface ProfileWorkspaceBlock {
  reason: 'out_of_credits' | string
  ownerEmail: string | null
}

export interface ProfileWorkspace {
  id: string
  name: string
  clerkOrganizationId: string | null
  type: ProfileWorkspaceType
  role: ProfileWorkspaceRole | null
  isOwner: boolean
  isAdmin: boolean
  isMember: boolean
  isTeamWorkspace: boolean
  avatarUrl: string | null
  description: string | null
  gracePeriodType: 'soft' | 'strict' | null
  ssoStatus: string | null
  isEnterpriseSubWorkspace: boolean
  subWorkspaceBlock: ProfileWorkspaceBlock | null
}

export interface ProfileWorkspaceWallet {
  id: string
  subscriptionBalance: number
  subscriptionTotal: number
  creditsBalance: number
  onDemandCredits: number
  walletCreatedAt: string | null
  nextPaymentDate: string | null
}

export interface ProfileCreditsRaw {
  availableCredits: number
  usedCredits: number
  monthlyRemaining: number
  purchasedCredits: number
  onDemandCredits: number
  totalAvailableCredits: number
  totalProgressCapacity: number
  planCapacity: number
}

export interface ProfileCredits {
  /** Monthly allocation plus purchased/top-up credits, normalized from backend credit-cents. */
  availableCredits: number
  /** Available credits plus optional on-demand/auto-refill credits, normalized. */
  totalAvailableCredits: number
  /** Monthly plan capacity plus optional on-demand capacity, normalized. */
  totalProgressCapacity: number
  /** Consumed monthly plan credits, normalized. */
  usedCredits: number
  monthlyRemaining: number
  purchasedCredits: number
  onDemandCredits: number
  planCapacity: number
  availablePercent: number
  usagePercent: number
  raw: ProfileCreditsRaw
}

export interface ProfileCreditsOptions {
  /**
   * Include wallet.onDemandCredits in totalAvailableCredits/progress capacity.
   * Defaults to true because it is spendable balance; app UIs with extra
   * auto-refill policy can pass false and show it separately.
   */
  includeOnDemand?: boolean
}

export interface ProfileSnapshot {
  user: ProfileUser | null
  workspaces: ProfileWorkspace[]
  currentWorkspace: ProfileWorkspace | null
  wallet: ProfileWorkspaceWallet | null
  credits: ProfileCredits | null
}

export interface SwitchWorkspaceInput {
  workspaceId: string
}

export interface ProfileClientConfig {
  /** The transport-agnostic profile adapter. Use one from `@higgsfield/fnf-adapters`, or your own. */
  profileAdapter: ProfileBackend
  observability?: FnfObservabilityOptions
}

export interface ProfileContext {
  profileAdapter: ProfileBackend
  observability: FnfObservabilityContext
}

export interface ProfileClient {
  getUser: () => Promise<ProfileUser | null>
  listWorkspaces: () => Promise<ProfileWorkspace[]>
  getCurrentWorkspace: () => Promise<ProfileWorkspace | null>
  getWallet: () => Promise<ProfileWorkspaceWallet | null>
  getCredits: (options?: ProfileCreditsOptions) => Promise<ProfileCredits | null>
  getSnapshot: (options?: ProfileCreditsOptions) => Promise<ProfileSnapshot>
  switchWorkspace: (input: SwitchWorkspaceInput) => Promise<ProfileSnapshot>
}
