import type { MediaBackend } from '../backend'
import type { FnfObservabilityContext, FnfObservabilityOptions } from '../observability'
import type { MediaRef } from '../types'

export type UploadType = 'image' | 'video' | 'audio'

/**
 * fnf-web's input-media discriminator per plane (input-media-model.ts) — the
 * `MediaRef.type` that goes on the job wire verbatim (e.g. seedance
 * medias[].data.type). Backends may return a more specific type (a job type
 * like `nano_banana_job` on fetched media) — preserve those; this is the
 * fallback vocabulary.
 */
export const REF_TYPE_BY_UPLOAD: Record<UploadType, string> = {
  image: 'media_input',
  video: 'video_input',
  audio: 'audio_input',
}

/** Convert backend upload-plane labels into submit-ready ref discriminators. */
export function normalizeMediaRefType(type: string | undefined, fallback: UploadType): string {
  return type === 'image' || type === 'video' || type === 'audio'
    ? REF_TYPE_BY_UPLOAD[type]
    : (type ?? REF_TYPE_BY_UPLOAD[fallback])
}

/** A caller-facing media reference: a structured ref, or a string (URL or id). */
export type MediaReference = string | MediaRef

export interface MediaListOptions {
  type: UploadType
  cursor?: string | number
  size?: number
}

export interface MediaListResult {
  items: MediaRef[]
  cursor?: string | number
}

export interface MediaGetOptions {
  id: string
  type: UploadType
}

// ── upload ──
/** The transport-agnostic byte container — all three are valid fetch BodyInit. */
export type MediaBytes = Blob | ArrayBuffer | Uint8Array

/**
 * Ready bytes, or a lazy thunk that produces them in the fetch-capable context.
 * Do not JSON-serialize browser File/Blob/ArrayBuffer/Uint8Array into this
 * shape. For server bridges, send files as multipart FormData, read bytes
 * server-side, then pass a real Blob/ArrayBuffer/Uint8Array here.
 */
export type MediaSource = MediaBytes | { read: () => Promise<MediaBytes> }

/**
 * The injected byte/data-plane capability. `transfer` does the raw presigned
 * PUT (no API host, no auth, Content-Type only) — it is deliberately NOT on the
 * `MediaBackend` JSON port nor on `Transport` (which is GET|POST + JSON only).
 * `fetchBytes` (optional) backs `uploadMediaFromUrl`.
 */
export interface BinaryUploader {
  transfer: (args: { uploadUrl: string, bytes: MediaBytes, contentType: string, signal?: AbortSignal }) => Promise<void>
  fetchBytes?: (url: string, opts?: { maxBytes?: number, signal?: AbortSignal }) => Promise<{ bytes: MediaBytes, contentType: string }>
}

export interface UploadInput {
  source: MediaSource
  type?: UploadType
  contentType?: string
  filename?: string
  /** Tagged onto the returned MediaRef so it drops straight into a job's media role. */
  role?: string
  jobId?: string
  forceIpCheck?: boolean
  forceNsfwCheck?: boolean
  startSeconds?: number
  endSeconds?: number
  /**
   * Throw on a moderation-blocked confirm. Default true. Covers BOTH wire
   * shapes: a 2xx confirm body with a blocked status (`MediaModerationError`)
   * and the HTTP 422 `error_type` twin (`IpDetectedError`/
   * `IpCheckRateLimitError`) — with `false`, both come back as a moderation
   * `UploadResult` instead.
   */
  throwOnModeration?: boolean
  /** Cancels the upload (checked between steps; aborts the binary PUT in flight). */
  signal?: AbortSignal
  /** Extra wire fields for presign AND confirm (the product sends `force_ip_check`/`surface` there). */
  extra?: Record<string, unknown>
}

export interface UploadSlot {
  mediaId: string
  uploadUrl: string
  url?: string
  type: UploadType
  contentType: string
  method: 'PUT'
}

export interface UploadModeration {
  status: string
  ipCheckFinished?: boolean | null
  ipDetected?: boolean | null
}

export interface UploadResult {
  ref: MediaRef
  mediaId: string
  status: string
  type: UploadType
  contentType: string
  filename: string
  url?: string
  moderation?: UploadModeration
}

export type SafeUploadResult =
  | { ok: true, result: UploadResult }
  | { ok: false, error: { code: string, message: string, status?: number, data?: unknown } }

/**
 * Optional resolver for turning a bare job id into a media ref (a completed
 * generation used as an input). Injected so the media half stays independent
 * of the jobs half — wire it from a job client when you need it.
 */
export type ResolveJobRef = (id: string) => Promise<MediaRef | undefined>

/** Config for `createMediaClient`. */
export interface MediaClientConfig {
  /** The transport-agnostic media adapter. Use one from `@higgsfield/fnf-adapters`, or your own. */
  mediaAdapter: MediaBackend
  /** The byte plane for the presigned PUT. Defaults to `createFetchUploader()`. */
  blobUploader?: BinaryUploader
  /** Optional: resolve a job id to a media ref (e.g. from a job client) for `resolve`. */
  resolveJob?: ResolveJobRef
  observability?: FnfObservabilityOptions
}

/** The shared context every media operation consumes. Build with `createMediaContext`. */
export interface MediaContext {
  mediaAdapter: MediaBackend
  blobUploader: BinaryUploader
  resolveJob?: ResolveJobRef
  observability: FnfObservabilityContext
}

export interface MediaClient {
  get: (id: string, type: UploadType) => Promise<MediaRef>
  list: (opts: MediaListOptions) => Promise<MediaListResult>
  resolve: (refs: MediaReference[]) => Promise<MediaRef[]>
  /**
   * Upload bytes end-to-end (presign → PUT → confirm) → submit-ready MediaRef.
   * `source` must be real binary data, not a JSON-shaped object. Invalid sources
   * fail early with `invalid_media_source`.
   */
  upload: (input: UploadInput) => Promise<UploadResult>
  /** Download a remote URL then upload it — same options as `upload` (needs `BinaryUploader.fetchBytes`). */
  uploadFromUrl: (input: Omit<UploadInput, 'source' | 'contentType'> & { url: string, maxBytes?: number }) => Promise<UploadResult>
  /** Presign only — returns the upload slot (the client does the PUT itself). */
  getUploadUrl: (req: { type: UploadType, filename?: string, contentType?: string, extra?: Record<string, unknown> }) => Promise<UploadSlot>
  /** Confirm a previously-uploaded media id. */
  confirm: (req: { mediaId: string, type: UploadType, filename?: string, jobId?: string, forceIpCheck?: boolean, forceNsfwCheck?: boolean, startSeconds?: number, endSeconds?: number, role?: string, throwOnModeration?: boolean, extra?: Record<string, unknown> }) => Promise<UploadResult>
}
