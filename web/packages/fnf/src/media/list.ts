import type { MediaRef } from '../types'
import type { MediaContext, MediaListOptions, MediaListResult } from './types'
import { observeAsync } from '../observability'
import { normalizeMediaRefType } from './types'

interface RawMediaItem {
  id: string
  url?: string
  type?: string
  created_at?: number
}

export async function listMedia(ctx: MediaContext, opts: MediaListOptions): Promise<MediaListResult> {
  return observeAsync(ctx.observability, 'fnf.media.list', {
    media_type: opts.type,
    ...(opts.size !== undefined ? { size: opts.size } : {}),
    ...(opts.cursor !== undefined ? { has_cursor: true } : {}),
  }, async () => {
    const body = (await ctx.mediaAdapter.listMedia(opts) ?? {}) as {
      items?: RawMediaItem[]
      medias?: RawMediaItem[]
      next_cursor?: string | number | null
      cursor?: string | number | null
    }
    const items: MediaRef[] = (body.items ?? body.medias ?? []).map(m => ({
      id: m.id,
      // Preserve job discriminators, but never leak raw upload-plane labels.
      type: normalizeMediaRefType(m.type, opts.type),
      ...(m.url ? { url: m.url } : {}),
    }))
    const cursor = body.next_cursor ?? body.cursor ?? undefined
    return { items, ...(cursor != null ? { cursor } : {}) }
  }, {
    successAttributes: result => ({ item_count: result.items.length, has_cursor: result.cursor !== undefined }),
  })
}
