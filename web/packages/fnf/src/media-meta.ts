import type { MediaInput, MediaMeta, MediaRef } from './types'

/**
 * Measures one media ref — answers its intrinsic `MediaMeta`, or undefined
 * when it can't (unknown kind, no url, measurement failed). The browser
 * implementation is `createDomMediaMetaResolver` (media entry point); a server
 * could back this with a probe service. Resolution is a capability the caller
 * injects, so the core stays zero-I/O.
 */
export type MediaMetaResolver = (ref: MediaRef) => Promise<MediaMeta | undefined>

/**
 * Fill in missing `meta` on every media ref of a submit input — the opt-in
 * async step in front of the sync meta rules (`dimensionsWithin`,
 * `durationsWithin`), mirroring how `adjust` fronts submit:
 *
 *   const measured = await resolveMediaMeta(input, resolver)
 *   await jobs.submit(measured) // meta rules now judge every ref
 *
 * Pure with respect to its arguments: returns a NEW input; refs that already
 * carry meta are untouched (the app usually knows sizes already — fnf's
 * InputImageMedia does); a resolver failure leaves that ref as-is rather than
 * failing the whole step. All refs resolve in parallel.
 */
export async function resolveMediaMeta<Input extends { media?: MediaInput }>(
  input: Input,
  resolve: MediaMetaResolver,
): Promise<Input> {
  const media = input.media
  if (!media)
    return input

  const out: MediaInput = {}
  await Promise.all(Object.entries(media).map(async ([role, value]) => {
    if (value === undefined)
      return
    out[role] = Array.isArray(value)
      ? await Promise.all(value.map(ref => withMeta(ref, resolve)))
      : await withMeta(value, resolve)
  }))
  return { ...input, media: out }
}

async function withMeta(ref: MediaRef, resolve: MediaMetaResolver): Promise<MediaRef> {
  if (ref.meta)
    return ref
  try {
    const meta = await resolve(ref)
    return meta ? { ...ref, meta } : ref
  }
  catch {
    return ref // measurement is best-effort; the backend re-validates anyway
  }
}
