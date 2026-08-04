import { ApiJobError, registerErrorCode } from '../errors'

/** Presign step (`getUploadUrl`) failed or returned no upload URL. */
export class PresignError extends ApiJobError {
  constructor(message = 'Failed to create an upload URL') { super('presigned_failed', message) }
}

/** The binary PUT to the presigned URL failed. */
export class UploadTransferError extends ApiJobError {
  constructor(message = 'Upload transfer failed', status?: number) { super('upload_failed', message, { status }) }
}

/** Upload source is not a valid binary container. Usually caused by JSON-serializing File/Blob/bytes. */
export class InvalidMediaSourceError extends ApiJobError {
  constructor(message = 'Media upload source must be Blob, ArrayBuffer, Uint8Array, or a read() function returning one') {
    super('invalid_media_source', message)
  }
}

/** The confirm step failed. */
export class ConfirmError extends ApiJobError {
  constructor(message = 'Failed to confirm upload') { super('confirm_failed', message) }
}

/** `uploadMediaFromUrl` could not fetch the remote URL (no `fetchBytes`, or fetch failed). */
export class UrlIngestError extends ApiJobError {
  constructor(message = 'Failed to ingest media from URL') { super('url_ingest_failed', message) }
}

/** The media adapter doesn't implement `getUploadUrl`/`confirmMedia`. */
export class UploadNotSupportedError extends ApiJobError {
  constructor() { super('upload_not_supported', 'This media adapter does not support uploads') }
}

/**
 * Confirm reported the media was blocked. One stable code; the specific wire
 * verdict ('ip_detected' | 'nsfw' | 'ip_check_rate_limit_reached') lives in
 * `data.status` — same one-code-one-class pattern as AccountSuspendedError.
 */
export class MediaModerationError extends ApiJobError<{ status: string }> {
  constructor(status: string) {
    super('media_moderation_blocked', `Media blocked by moderation: ${status}`, { data: { status } })
  }
}

// Rehydration entries for the media codes (registered here — not in errors.ts —
// to avoid a circular import between the two halves). These run at IMPORT time,
// which is why this file is listed in package.json `sideEffects` — any future
// module that registers codes on import must be added there too, or production
// tree-shaking silently drops the registrations and cross-boundary rehydration
// degrades to the base ApiJobError.
registerErrorCode('presigned_failed', j => new PresignError(j.message))
registerErrorCode('upload_failed', j => new UploadTransferError(j.message, j.status))
registerErrorCode('invalid_media_source', j => new InvalidMediaSourceError(j.message))
registerErrorCode('confirm_failed', j => new ConfirmError(j.message))
registerErrorCode('url_ingest_failed', j => new UrlIngestError(j.message))
registerErrorCode('upload_not_supported', () => new UploadNotSupportedError())
registerErrorCode('media_moderation_blocked', j => new MediaModerationError((j.data as { status?: string } | undefined)?.status ?? 'blocked'))
