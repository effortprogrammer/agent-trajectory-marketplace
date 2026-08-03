// Backend ports (interfaces — every concrete adapter lives in
// @higgsfield/fnf-adapters, EXCEPT the one bundled below)
export type { CharacterBackend, ConfirmMediaRequest, ConfirmSubmit, ConfirmSubmitRequest, FnfAdapter, GenerationBackend, JobListQuery, MediaBackend, MediaGetQuery, MediaListQuery, ProfileBackend, RealtimeBackend, ReferenceBackend, SwitchWorkspaceRequest, UploadUrlRequest } from './backend'
// Custom-reference character training — also available at "@higgsfield/fnf/characters".
export { buildCharacterCreateRequest, createCharacterClient, parseCharacter } from './characters'
export type { Character, CharacterClient, CharacterClientConfig, CharacterCreateRequest, CharacterStatus, CharacterType, CharacterWaitOptions, CreateCharacterInput } from './characters'
// Elements library — also available at "@higgsfield/fnf/references".
export { createReferenceClient, parseReference } from './references'
export type { Reference, ReferenceCategory, ReferenceClient, ReferenceClientConfig, ReferenceListQuery, ReferenceListResult, ReferenceMedia, ReferenceStatus, ReferenceWaitOptions } from './references'
// Stateful realtime image editing and saved custom styles — also available at
// "@higgsfield/fnf/realtime".
export {
  buildCreateRealtimeCustomStyleRequest,
  buildRealtimeChainCostRequest,
  buildRealtimeChainEditRequest,
  buildRealtimeChainFinalizeRequest,
  buildUpdateRealtimeCustomStyleRequest,
  createRealtimeClient,
  parseRealtimeChainCostEstimate,
  parseRealtimeChainEditResult,
  parseRealtimeChainFinalizeResult,
  parseRealtimeCustomStyle,
  parseRealtimeCustomStyleList,
  validateRealtimeCustomStyleListQuery,
} from './realtime'
export type {
  CreateRealtimeCustomStyleInput,
  RealtimeAspectRatio,
  RealtimeChainCostEstimate,
  RealtimeChainCostInput,
  RealtimeChainEditInput,
  RealtimeChainEditOptions,
  RealtimeChainEditResult,
  RealtimeChainFinalizeInput,
  RealtimeChainFinalizeResult,
  RealtimeClient,
  RealtimeClientConfig,
  RealtimeCustomStyle,
  RealtimeCustomStyleListQuery,
  RealtimeCustomStyleListResult,
  RealtimeCustomStyleReference,
  RealtimeEditParams,
  RealtimeEditPollOptions,
  RealtimeImageRef,
  RealtimeImageType,
  RealtimeMode,
  RealtimeReferenceMode,
  RealtimeResolution,
  RealtimeSettings,
  RealtimeTarget,
  UpdateRealtimeCustomStyleInput,
} from './realtime'
// Client half — also available at "@higgsfield/fnf/client" (models: "@higgsfield/fnf/jobs")
export { createContext, createJobClient, entryFor } from './client'
export { adjust, cancelGeneration, estimateCost, generationsFromBody, getGeneration, listGenerations, pollGeneration, pollJobSetGroup, safeSubmit, submit, waitGenerations } from './client'
export type {
  AdjustResult,
  BaseSubmitFields,
  ClientConfig,
  CostEstimate,
  GenerationContext,
  JobClient,
  ListOptions,
  ListResult,
  PollOptions,
  SafeSubmitResult,
  SubmitInputFor,
  SubmitResult,
  WaitOptions,
} from './client'

export { defineJob } from './define-job'

export type { JobEntry, JobParams, SettingsInput } from './define-job'
export {
  AccountSuspendedError,
  ApiJobError,
  ApiMessageError,
  AutoTopUpSuspendedError,
  BatchRateLimitError,
  BeatFitLimitError,
  BillingError,
  ConfirmationRejectedError,
  errorFromJSON,
  errorFromResponse,
  GraceDailyLimitError,
  IpCheckRateLimitError,
  IpDetectedError,
  JobAbortedError,
  JobInProgressError,
  JobTimeoutError,
  KybVerificationRequiredError,
  MinimumPlanError,
  NotEnoughBoostCreditsError,
  OutOfCreditsError,
  PromptNsfwError,
  RateLimitError,
  registerErrorCode,
  SharedTeamSubscriptionInactiveError,
  SubscriptionRenewalFailedError,
  throwIfAborted,
  UnknownSubmitResponseError,
  UnlimitedGenerationNotAllowedError,
  ValidationError,
  VpnDetectedError,
  WorkspaceMemberSpendPausedError,
  WorkspaceSelectionRequiredError,
} from './errors'
export type {
  ApiJobErrorJSON,
  AutoTopUpErrorType,
  BillingContext,
  BillingPeriod,
  GraceLimitReachedType,
  MinimumPlanFeature,
  SubscriptionPlanType,
  TeamErrorDetails,
} from './errors'

export { field, group } from './group'
export type { Codec, FieldDef } from './group'

export { atLeastOneOf, checkMedia, dimensionsWithin, durationsWithin, maxTotal, mediaCodec, requiresOneOf } from './groups/media'
export type { DimensionLimits, MediaConfig, MediaIssue, MediaRule } from './groups/media'
export { promptCodec } from './groups/prompt'
export { countRefs, intRange, oneOf, promptMax, promptRequired, randomSeed } from './jobs/checks'
export { aspectRatioDimensions, closestRatioBySize, firstSizeMeta, lookupSize, simplifyRatio } from './jobs/dimensions'
export type { AspectRatioDimensions } from './jobs/dimensions'
export { gptImage2, GptImage2AspectRatio } from './jobs/gpt-image-2'
export { grokImagine, GrokImagineAspectRatio, GrokImagineResolution, grokImagineV15 } from './jobs/grok-imagine'
export { happyHorse, HappyHorseAspectRatio, HappyHorseResolution } from './jobs/happy-horse'
export { KLING_DEFAULT_MOTION_ID, KlingModel, klingVideo } from './jobs/kling'

export { kling3_0, Kling3AspectRatio, Kling3Mode, Kling3Sound } from './jobs/kling-3'
export { kling3MotionControl, Kling3MotionControlMode, Kling3MotionControlOrientation } from './jobs/kling-3-motion-control'
export { nanoBanana2, NanoBanana2AspectRatio } from './jobs/nano-banana-2'
export { nanoBanana2Upscale, NanoBanana2UpscaleAspectRatio } from './jobs/nano-banana-2-upscale'
export { nanoBananaFlash, NanoBananaFlashAspectRatio } from './jobs/nano-banana-flash'
export { RecraftV41AspectRatio, recraftV41Image, RecraftV41Model, RecraftV41ModelType } from './jobs/recraft-v4-1'
export { seedance2_0, Seedance2AspectRatio } from './jobs/seedance-2-0'
export { seedreamV4_5, SeedreamV4_5AspectRatio } from './jobs/seedream-v4-5'
export { DEFAULT_SOUL_CINEMA_OLZHAS_STYLE_ID, DEFAULT_SOUL_CINEMA_STYLE_ID, DEFAULT_SOUL_V2_STYLE_ID, soulCinemaImage, SoulV2AspectRatio, soulV2Image } from './jobs/soul-v2'
export { DEFAULT_SOUL_STYLE_ID, textToImageSoul } from './jobs/text2image-soul'
export { topazImageGenerativeUpscale, TopazImageModel, topazImageUpscale, TopazImageUpscaleFactor } from './jobs/topaz-image-upscale'
export { veo3_1Lite, Veo31LiteAspectRatio, Veo31LiteResolution } from './jobs/veo-3-1-lite'
export { batch, extractAngleRefIds, firstMetaDuration, firstMetaSize, integerRange, refsFor, requiredPromptOrRole } from './jobs/video-helpers'
export type { Size } from './jobs/video-helpers'
export { bytedanceVideoUpscale, BytedanceVideoUpscalePreset, BytedanceVideoUpscaleResolution, higgsfieldVideoUpscale, soraEnhanceVideo, TopazVideoEnhancementModel, TopazVideoFocusFix, TopazVideoModel, TopazVideoParameters, TopazVideoResolution, topazVideoUpscale } from './jobs/video-upscale'
export { wan27, Wan27AspectRatio, Wan27Quality } from './jobs/wan-2-7'
// Media half — also available at "@higgsfield/fnf/media"
export {
  ConfirmError,
  confirmMedia,
  createDomMediaMetaResolver,
  createFetchUploader,
  createMediaClient,
  createMediaContext,
  createMemoryUploader,
  defaultFilenameForContentType,
  getMedia,
  getUploadUrl,
  inferContentType,
  inferUploadType,
  listMedia,
  MediaModerationError,
  PresignError,
  resolveMedia,
  safeUploadMedia,
  transferBytes,
  uploadMedia,
  uploadMediaFromUrl,
  UploadNotSupportedError,
  UploadTransferError,
  UrlIngestError,
} from './media'
export type {
  BinaryUploader,
  MediaBytes,
  MediaClient,
  MediaClientConfig,
  MediaContext,
  MediaGetOptions,
  MediaListOptions,
  MediaListResult,
  MediaReference,
  MediaSource,
  ResolveJobRef,
  SafeUploadResult,
  UploadFromUrlInput,
  UploadInput,
  UploadModeration,
  UploadResult,
  UploadSlot,
  UploadType,
} from './media'
export { resolveMediaMeta } from './media-meta'
export type { MediaMetaResolver } from './media-meta'
export type { AdjustKind, Adjustment } from './normalize'
export {
  composeObservers,
  createConsoleObserver,
  createNoopObserver,
  createObservabilityContext,
  observeAsync,
  observeEvent,
  withObservedGenerationBackend,
  withObservedMediaBackend,
  withObservedProfileBackend,
  withObservedTransport,
  withObservedUploader,
} from './observability'

export type {
  FnfObservabilityContext,
  FnfObservabilityOptions,
  FnfObservationAttributes,
  FnfObservationAttributeValue,
  FnfObservationError,
  FnfObservationEvent,
  FnfObservationPhase,
  FnfObserver,
  ObserveAsyncOptions,
} from './observability'
// Profile/account half — also available at "@higgsfield/fnf/profile"
export {
  calculateProfileCredits,
  createProfileClient,
  createProfileContext,
  getCurrentProfileWorkspace,
  getProfileCredits,
  getProfileSnapshot,
  getProfileUser,
  getProfileWallet,
  listProfileWorkspaces,
  mapProfileUser,
  mapProfileWallet,
  mapProfileWorkspace,
  mapProfileWorkspaces,
  switchProfileWorkspace,
} from './profile'

export type {
  ProfileClient,
  ProfileClientConfig,
  ProfileContext,
  ProfileCredits,
  ProfileCreditsOptions,
  ProfileCreditsRaw,
  ProfileSnapshot,
  ProfileUser,
  ProfileWorkspace,
  ProfileWorkspaceBlock,
  ProfileWorkspaceRole,
  ProfileWorkspaceType,
  ProfileWorkspaceWallet,
  SwitchWorkspaceInput,
} from './profile'
export { buildRegistry } from './registry'

export type { Registry } from './registry'
export { getJobPhase, getMediaType, getPreviewUrl, getRawUrl, hasResult, isCompleted, isFailed, isFailedJobStatus, isFromJob, isGenerating, isTerminalJobStatus } from './selectors'

export type { JobPhase } from './selectors'
export { buildWireParams, parseGeneration, parseSettings } from './spec'
export type { JobResponse } from './spec'
export type { Transport, TransportRequest, TransportResponse } from './transport'
export { isTerminal, TERMINAL_STATUSES } from './types'

export type { Generation, GenerationInput, GenerationResults, GenerationStatus, MediaInput, MediaMeta, MediaRef, OutputType, PromptInput } from './types'
// LLM access (spec §5.2) — Worker-side only; the platform token must never
// reach the browser bundle.
export type {
  LlmBackend,
  LlmCompleteRequest,
  LlmCompletion,
  LlmDelta,
  LlmMessage,
  LlmMessagePart,
  LlmToolCall,
  LlmToolCallDelta,
  LlmToolDef,
  LlmUsage,
} from './llm/backend'
export { createLlmClient } from './llm/client'
export type { LlmClientOptions } from './llm/client'
export { errorFromLlmResponse } from './llm/errors'

// The ONE bundled adapter implementation — the Workflow Platform adapter for
// https://fnf.internal (+ its fetch transport), so generated-app hosts that
// vendor only this package are self-sufficient. Also at
// "@higgsfield/fnf/workflow-platform".
export { createFetchTransport, createWorkflowPlatformAdapter } from './workflow-platform'
export type { FetchTransportOptions, WorkflowPlatformAdapterOptions } from './workflow-platform'

export { aspectRatio, duration, getNormalize, getWireName, wire, z } from './z'
export type { Normalize } from './z'
