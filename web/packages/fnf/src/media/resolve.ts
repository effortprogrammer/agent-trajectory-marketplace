import type { MediaRef } from '../types'
import type { MediaContext, MediaReference } from './types'
import { JobAbortedError } from '../errors'
import { observeAsync } from '../observability'
import { getMediaType } from '../selectors'

const HTTPS_RE = /^https:\/\//i
// getMediaType covers image/video output kinds; audio extensions are its blind
// spot (same sniff as the DOM meta resolver).
const AUDIO_URL = /\.(?:mp3|wav|m4a|aac|ogg|flac)(?:[?#]|$)/i

/** The plane discriminator for a bare URL — extension-sniffed, image-default. */
function typeForUrl(url: string): string {
  if (AUDIO_URL.test(url))
    return 'audio_input'
  return getMediaType(url) === 'video' ? 'video_input' : 'media_input'
}

async function resolveOne(ctx: MediaContext, ref: MediaReference): Promise<MediaRef> {
  // Already structured — pass through unchanged.
  if (typeof ref !== 'string')
    return ref
  // An HTTPS URL is usable directly as a media input.
  if (HTTPS_RE.test(ref))
    return { id: ref, type: typeForUrl(ref), url: ref }
  // Otherwise it's an id. If a job resolver is wired (e.g. from a job client),
  // try resolving it to a completed generation; else fall back to a media input.
  if (ctx.resolveJob) {
    try {
      const resolved = await ctx.resolveJob(ref)
      if (resolved)
        return resolved
    }
    catch (err) {
      // A cancel is not "not a job" — propagate it; anything else falls through
      // to the media-input fallback (the resolver is best-effort by contract).
      if (err instanceof JobAbortedError)
        throw err
    }
  }
  return { id: ref, type: 'media_input' }
}

export async function resolveMedia(ctx: MediaContext, refs: MediaReference[]): Promise<MediaRef[]> {
  return observeAsync(ctx.observability, 'fnf.media.resolve', { ref_count: refs.length }, () => Promise.all(refs.map(ref => resolveOne(ctx, ref))), {
    successAttributes: result => ({ resolved_count: result.length }),
  })
}
