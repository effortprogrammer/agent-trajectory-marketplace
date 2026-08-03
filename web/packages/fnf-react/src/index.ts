// Attachments — the input-media presenter: files in, submit-ready refs out
export { AttachmentsController } from './attachments'
export type { Attachment, AttachmentsMediaClient, AttachmentsOptions, AttachmentStatus, AttachmentUploadOptions } from './attachments'
export { useAttachments } from './attachments-hook'

export { characterQueryOptions } from './character-query'
export type { CharacterQueryClient, CharacterQueryOptions } from './character-query'
export { costQueryOptions } from './cost-query'
export type { CostQueryClient, CostQueryOptions } from './cost-query'
export { referenceQueryOptions, referencesQueryOptions } from './reference-query'
export type { ReferenceQueryClient, ReferenceQueryOptions, ReferencesQueryClient, ReferencesQueryOptions } from './reference-query'
export { realtimeChainCostQueryOptions, realtimeCustomStylesQueryOptions } from './realtime-query'
export type { RealtimeQueryClient, RealtimeQueryOptions } from './realtime-query'
// The base the controllers share — extend it for your own presenters
export { ExternalStore } from './external-store'
export { useStore } from './external-store-hook'
// Cache door — the ONE way generation snapshots enter the query cache
export { applyGenerations, prependGenerations, removeGenerationQueries } from './generation-cache'
export { foldGeneration } from './generation-fold'
// Query factories — pull-shaped reads as TanStack queryOptions
export { DEFAULT_POLL_INTERVAL_MS, generationQueryOptions } from './generation-query'

export type { GenerationQueryClient, LiveQueryOptions } from './generation-query'
// Feed bridge — resume polling jobs restored from history after a remount.
export { useLiveFeedGenerations } from './live-feed-generations-hook'
// Submit — one submit-to-terminal lifecycle as observable state
export { GenerationRun } from './generation-run'
export type { GenerationRunClient, GenerationRunOptions, GenerationRunStatus } from './generation-run'
export { useGenerationRun } from './generation-run-hook'
export type { GenerationRunHookOptions } from './generation-run-hook'
export { jobSetQueryOptions } from './job-set-query'
export type { JobSetQueryClient } from './job-set-query'
export { flattenFeedPages, jobsFeedQueryOptions } from './jobs-feed-query'
export type { JobsFeedQueryClient } from './jobs-feed-query'
// Keys — the public query-key contract (build keys ONLY through these)
export { fnfKeys } from './keys'

export type { FnfScopeOptions, JobsQuery } from './keys'
export { RefCountPool } from './pool'
export type { PoolEntry } from './pool'
// Profile queries — account/workspace/wallet reads as TanStack queryOptions
export {
  profileCreditsQueryOptions,
  profileCurrentWorkspaceQueryOptions,
  profileSnapshotQueryOptions,
  profileUserQueryOptions,
  profileWalletQueryOptions,
  profileWorkspacesQueryOptions,
  setProfileSnapshot,
} from './profile-query'

export type { ProfileCreditsQueryOptions, ProfileQueryClient, ProfileQueryOptions } from './profile-query'
// Provider — stable SDK clients from one React context
export { createFnfReactClients, FnfProvider, useFnf, useFnfCharacterClient, useFnfJobClient, useFnfJobs, useFnfLlmClient, useFnfMediaClient, useFnfObservability, useFnfProfileClient, useFnfRealtimeClient, useFnfReferenceClient, useFnfScopeKey } from './provider'
export type { FnfProviderProps, FnfReactClients, FnfReactClientsConfig } from './provider'

export { Realtime } from './realtime'
export type { RealtimeTransport } from './realtime'
export { getWirePreview, useFnfWirePreview } from './wire-preview'
export type { WirePreviewResult } from './wire-preview'
export { switchWorkspaceMutationOptions, useSwitchWorkspaceMutation } from './workspace-switch'
export type { SwitchWorkspaceClient, SwitchWorkspaceMutationConfig } from './workspace-switch'
