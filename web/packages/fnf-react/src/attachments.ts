import type { MediaRef, UploadInput, UploadModeration, UploadResult } from '@higgsfield/fnf/media'
import type { FnfObservabilityContext, FnfObservabilityOptions } from '@higgsfield/fnf/observability'
import { ApiJobError } from '@higgsfield/fnf/errors'
import { createDomMediaMetaResolver, isBlockedModeration } from '@higgsfield/fnf/media'
import { createObservabilityContext, observeEvent } from '@higgsfield/fnf/observability'
import { ExternalStore } from './external-store'

/** What the presenter needs from a media client — structural on purpose. */
export interface AttachmentsMediaClient {
  upload: (input: UploadInput) => Promise<UploadResult>
}

/**
 * Everything `media.upload` accepts except the byte source — forwarded
 * VERBATIM. The presenter only fills defaults (filename/contentType from the
 * File, `throwOnModeration: false` so verdicts become item state, a
 * per-item cancellation signal); any of them can be overridden here.
 */
export type AttachmentUploadOptions = Omit<UploadInput, 'source'>

export type AttachmentStatus = 'uploading' | 'ready' | 'blocked' | 'failed'

export interface Attachment {
  /** Stable local identity — survives the upload, safe as a React key. */
  readonly key: string
  /** Present for file-born attachments (absent when a ready ref was added). */
  readonly file?: File
  /** The media role this attachment was added for (drives the submit slot). */
  readonly role?: string
  /** The submit-ready ref — present once `status` is `ready` (or `blocked`). */
  readonly ref?: MediaRef
  /** Renderable immediately: a local object URL while uploading, the remote url after. */
  readonly previewUrl?: string
  readonly status: AttachmentStatus
  /** The typed upload failure when `status` is `failed`. */
  readonly error?: ApiJobError
  /** The moderation verdict when the backend blocked the upload. */
  readonly moderation?: UploadModeration
}

export interface AttachmentsOptions {
  /** Controller-wide upload options (per-`add` options override them). */
  upload?: AttachmentUploadOptions
  /**
   * Measure intrinsic size/duration into `MediaRef.meta` from the local file
   * (default true; a no-op outside a DOM). Meta drives the SDK's media rules
   * and the product-parity 'auto' aspect-ratio resolution.
   */
  measure?: boolean
  observability?: FnfObservabilityOptions
}

/**
 * The attachments presenter: files in → previews now, uploads in flight,
 * submit-ready `MediaRef`s out. The frontend counterpart of fnf-web's
 * `InputMediaController`, rebuilt on the SDK media client:
 *
 *   const refs = await attachments.settled()       // wait out in-flight uploads
 *   client.submit({ media: { image: refs }, ... })
 *
 * Per-item lifecycle: `uploading` → `ready` | `blocked` (moderation verdict,
 * kept visible instead of thrown) | `failed` (typed error, `retry`-able).
 * Removing an in-flight item aborts its upload; object URLs are revoked when
 * the remote url takes over and on remove/clear/dispose. No counts, types,
 * or roles are restricted here — the job declarations validate media; the
 * presenter only presents.
 */
export class AttachmentsController extends ExternalStore {
  private _items: Attachment[] = []
  private readonly inFlight = new Set<Promise<void>>()
  private readonly localUrls = new Map<string, string>()
  private readonly aborts = new Map<string, AbortController>()
  private readonly uploadOpts = new Map<string, AttachmentUploadOptions | undefined>()
  private readonly measure = createDomMediaMetaResolver()
  private readonly observability: FnfObservabilityContext
  private seq = 0

  constructor(
    private readonly media: AttachmentsMediaClient,
    private readonly opts: AttachmentsOptions = {},
  ) {
    super()
    this.observability = createObservabilityContext(opts.observability)
  }

  get items(): Attachment[] {
    return this._items
  }

  /** Submit-ready refs (ready items only, in display order). */
  get refs(): MediaRef[] {
    return this._items.flatMap(item => item.status === 'ready' && item.ref ? [item.ref] : [])
  }

  get isUploading(): boolean {
    return this._items.some(item => item.status === 'uploading')
  }

  /**
   * Add files (uploaded immediately, preview available at once) or
   * already-uploaded refs (ready as-is). `opts` are upload options for THESE
   * entries, merged over the controller-wide ones (`role` lives here too).
   * Returns the new items' keys.
   */
  add(input: File | MediaRef | Array<File | MediaRef>, opts?: AttachmentUploadOptions): string[] {
    const entries = Array.isArray(input) ? input : [input]
    const keys: string[] = []
    observeEvent(this.observability, 'fnf.react.attachments.add', {
      item_count: entries.length,
      file_count: entries.filter(entry => entry instanceof File).length,
      ref_count: entries.filter(entry => !(entry instanceof File)).length,
      ...(opts?.role ?? this.opts.upload?.role ? { role: opts?.role ?? this.opts.upload?.role ?? null } : {}),
    })
    for (const entry of entries) {
      const key = `att-${++this.seq}`
      keys.push(key)
      if (entry instanceof File) {
        const previewUrl = this.createLocalUrl(key, entry)
        this._items = [...this._items, { key, file: entry, role: opts?.role ?? this.opts.upload?.role, previewUrl, status: 'uploading' }]
        this.uploadOpts.set(key, opts)
        this.track(this.upload(key, entry, opts))
      }
      else {
        this._items = [...this._items, { key, ref: entry, role: entry.role ?? opts?.role, previewUrl: entry.url, status: 'ready' }]
      }
    }
    this.commit()
    return keys
  }

  /** Re-upload a failed file-born attachment with its original options. */
  retry(key: string): void {
    const item = this._items.find(i => i.key === key)
    if (!item || item.status !== 'failed' || !item.file)
      return
    observeEvent(this.observability, 'fnf.react.attachments.retry', { attachment_key: key })
    this.patch(key, { status: 'uploading', error: undefined })
    this.track(this.upload(key, item.file, this.uploadOpts.get(key)))
  }

  /** Remove the item; an in-flight upload is aborted. */
  remove(key: string): void {
    const item = this._items.find(entry => entry.key === key)
    observeEvent(this.observability, 'fnf.react.attachments.remove', {
      attachment_key: key,
      ...(item ? { status: item.status } : {}),
    })
    this.aborts.get(key)?.abort()
    this.aborts.delete(key)
    this.uploadOpts.delete(key)
    this.revokeLocalUrl(key)
    this._items = this._items.filter(item => item.key !== key)
    this.commit()
  }

  /** Reorder (drag-and-drop): move the item at `from` to position `to`. */
  move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this._items.length || to >= this._items.length)
      return
    const next = [...this._items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    this._items = next
    this.commit()
  }

  clear(): void {
    observeEvent(this.observability, 'fnf.react.attachments.clear', { item_count: this._items.length })
    for (const controller of this.aborts.values()) controller.abort()
    this.aborts.clear()
    this.uploadOpts.clear()
    for (const key of [...this.localUrls.keys()]) this.revokeLocalUrl(key)
    this._items = []
    this.commit()
  }

  /** `clear` + drop in-flight bookkeeping — call when the owner unmounts. */
  dispose(): void {
    this.clear()
    this.inFlight.clear()
  }

  /**
   * Wait for every in-flight upload to finish, then return the submit-ready
   * refs — the "user hit Generate while uploads are running" path. Failures
   * don't reject; they stay visible as `failed`/`blocked` items.
   */
  async settled(): Promise<MediaRef[]> {
    while (this.inFlight.size > 0)
      await Promise.allSettled([...this.inFlight])
    observeEvent(this.observability, 'fnf.react.attachments.settled', {
      item_count: this._items.length,
      ready_count: this.refs.length,
    })
    return this.refs
  }

  private async upload(key: string, file: File, opts?: AttachmentUploadOptions): Promise<void> {
    const abort = new AbortController()
    this.aborts.set(key, abort)

    // Measure from the local preview in parallel with the upload. The File's
    // mime drives the kind (a blob URL has no extension to sniff); the
    // resolver caches per url and resolves undefined outside a DOM. Best
    // effort by contract: a measurement failure must never fail the upload.
    const previewUrl = this.localUrls.get(key)
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image'
    observeEvent(this.observability, 'fnf.react.attachments.upload_start', {
      attachment_key: key,
      media_type: kind,
      ...(opts?.role ?? this.opts.upload?.role ? { role: opts?.role ?? this.opts.upload?.role ?? null } : {}),
    })
    const measured = this.opts.measure === false || !previewUrl
      ? Promise.resolve(undefined)
      : this.measure({ id: key, type: kind, url: previewUrl }).catch(() => undefined)

    try {
      const result = await this.media.upload({
        source: file,
        filename: file.name,
        contentType: file.type || undefined,
        throwOnModeration: false, // verdicts become item state, not throws
        signal: abort.signal,
        ...this.opts.upload,
        ...opts,
      })
      const meta = await measured
      const ref: MediaRef = { ...result.ref, ...(meta ? { meta } : {}) }
      if (result.moderation && isBlockedModeration(result.moderation.status)) {
        // keep the local preview — a blocked upload has no usable remote url
        observeEvent(this.observability, 'fnf.react.attachments.blocked', {
          attachment_key: key,
          media_id: result.mediaId,
          moderation_status: result.moderation.status,
        })
        this.patch(key, { ref, status: 'blocked', moderation: result.moderation })
        return
      }
      if (ref.url)
        this.revokeLocalUrl(key)
      observeEvent(this.observability, 'fnf.react.attachments.ready', {
        attachment_key: key,
        media_id: result.mediaId,
        media_type: result.type,
        status: result.status,
      })
      this.patch(key, { ref, status: 'ready', previewUrl: ref.url ?? this.localUrls.get(key), moderation: result.moderation })
    }
    catch (err) {
      const error = err instanceof ApiJobError ? err : new ApiJobError('unexpected', err instanceof Error ? err.message : String(err))
      observeEvent(this.observability, 'fnf.react.attachments.failed', {
        attachment_key: key,
        error_code: error.code,
        ...(error.status !== undefined ? { error_status: error.status } : {}),
      })
      this.patch(key, { status: 'failed', error })
    }
    finally {
      if (this.aborts.get(key) === abort)
        this.aborts.delete(key)
    }
  }

  private track(promise: Promise<void>): void {
    this.inFlight.add(promise)
    void promise.finally(() => this.inFlight.delete(promise))
  }

  private patch(key: string, changes: Partial<Attachment>): void {
    const at = this._items.findIndex(item => item.key === key)
    if (at < 0)
      return // removed while uploading — drop the result
    this._items = [...this._items.slice(0, at), { ...this._items[at], ...changes }, ...this._items.slice(at + 1)]
    this.commit()
  }

  private createLocalUrl(key: string, file: File): string | undefined {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function')
      return undefined
    const url = URL.createObjectURL(file)
    this.localUrls.set(key, url)
    return url
  }

  private revokeLocalUrl(key: string): void {
    const url = this.localUrls.get(key)
    if (url === undefined)
      return
    this.localUrls.delete(key)
    URL.revokeObjectURL(url)
  }
}
