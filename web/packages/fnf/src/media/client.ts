import type { MediaClient, MediaClientConfig } from './types'
import { createMediaContext } from './context'
import { getMedia } from './get'
import { listMedia } from './list'
import { resolveMedia } from './resolve'
import { confirmMedia, getUploadUrl, uploadMedia, uploadMediaFromUrl } from './upload'

/**
 * Compose the media operations into a client. Sugar over the free functions —
 * every method binds the shared media context. Build a context and call the
 * operations directly if you only need one:
 *
 *   const ctx = createMediaContext(config)
 *   await getMedia(ctx, id, 'image')
 */
export function createMediaClient(config: MediaClientConfig): MediaClient {
  const ctx = createMediaContext(config)
  return {
    get: (id, type) => getMedia(ctx, id, type),
    list: opts => listMedia(ctx, opts),
    resolve: refs => resolveMedia(ctx, refs),
    upload: input => uploadMedia(ctx, input),
    uploadFromUrl: input => uploadMediaFromUrl(ctx, input),
    getUploadUrl: req => getUploadUrl(ctx, req),
    confirm: req => confirmMedia(ctx, req),
  }
}
