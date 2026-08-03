// The opt-in measurement step for the meta rules (dimensionsWithin/durationsWithin):
// fill MediaRef.meta before validating. The DOM resolver is the browser capability;
// resolveMediaMeta is the pure orchestration over any resolver.
export { resolveMediaMeta } from '../media-meta'

export type { MediaMetaResolver } from '../media-meta'
// MediaClient.get/list/resolve return MediaRef — export it so a /media-only
// consumer doesn't need the root barrel.
export type { MediaMeta, MediaRef } from '../types'
export { createFetchUploader, createMemoryUploader } from './blob-uploader'
export { createMediaClient } from './client'
export { createMediaContext } from './context'
export { createDomMediaMetaResolver } from './dom-meta-resolver'
export {
  ConfirmError,
  InvalidMediaSourceError,
  MediaModerationError,
  PresignError,
  UploadNotSupportedError,
  UploadTransferError,
  UrlIngestError,
} from './errors'
export { getMedia } from './get'
export { listMedia } from './list'
export { defaultFilenameForContentType, inferContentType, inferUploadType } from './mime'
export { resolveMedia } from './resolve'
// Upload kind → product input-media discriminator (media_input/video_input/
// audio_input) — the vocabulary media adapters answer presigns with.
export { REF_TYPE_BY_UPLOAD } from './types'
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
  UploadInput,
  UploadModeration,
  UploadResult,
  UploadSlot,
  UploadType,
} from './types'

export { confirmMedia, getUploadUrl, isBlockedModeration, safeUploadMedia, transferBytes, uploadMedia, uploadMediaFromUrl } from './upload'
export type { UploadFromUrlInput } from './upload'
