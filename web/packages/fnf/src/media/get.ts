import type { MediaRef } from '../types'
import type { MediaContext, MediaGetOptions } from './types'
import { observeAsync } from '../observability'
import { normalizeMediaRefType } from './types'

interface RawMedia {
  id?: string
  url?: string
  type?: string
}

/**
 * Get a single media item by id. The backend route is per-type (image/video/
 * audio), so the type must be supplied — the adapter routes on it. Normalizes
 * the raw payload to a `MediaRef` usable as a job input: the backend's own
 * job discriminator wins (fetched media can carry a type like
 * `nano_banana_job`, valid on the wire); raw `image`/`video`/`audio` plane
 * labels and missing types normalize to the same input vocabulary upload uses.
 */
export async function getMedia(ctx: MediaContext, id: string, type: MediaGetOptions['type']): Promise<MediaRef> {
  return observeAsync(ctx.observability, 'fnf.media.get', { media_id: id, media_type: type }, async () => {
    const raw = (await ctx.mediaAdapter.getMedia({ id, type }) ?? {}) as RawMedia
    return {
      id: raw.id ?? id,
      type: normalizeMediaRefType(raw.type, type),
      ...(raw.url ? { url: raw.url } : {}),
    }
  }, {
    successAttributes: ref => ({ ref_type: ref.type }),
  })
}
