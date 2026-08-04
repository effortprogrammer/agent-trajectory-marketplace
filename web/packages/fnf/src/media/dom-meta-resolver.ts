import type { MediaMetaResolver } from '../media-meta'
import type { MediaMeta, MediaRef } from '../types'
import { getMediaType } from '../selectors'

/**
 * Browser-backed `MediaMetaResolver`: measures images via `Image` and
 * video/audio via detached media elements — the same technique fnf-web's
 * `getImageSize`/`getMediaMetaVideo` use. Outside a DOM (Node, workers) every
 * ref resolves to undefined, so callers can wire it unconditionally. A failed
 * measurement (decode error, unsupported codec) resolves undefined too — the
 * `MediaMetaResolver` contract — and is NOT cached, so a retry of the same
 * url re-measures instead of replaying the failure. Successes are cached per
 * url for the resolver's lifetime.
 *
 * The package core compiles without `lib: dom`, so the handful of DOM shapes
 * used here are declared structurally instead of imported.
 */
export function createDomMediaMetaResolver(): MediaMetaResolver {
  const cache = new Map<string, Promise<MediaMeta | undefined>>()

  return async (ref: MediaRef) => {
    if (!dom() || !ref.url)
      return undefined
    const url = ref.url
    let pending = cache.get(url)
    if (!pending) {
      const kind = ref.type === 'image' || ref.type === 'video' || ref.type === 'audio' ? ref.type : undefined
      pending = measure(url, kind).catch(() => {
        cache.delete(url) // don't poison future retries of this url
        return undefined
      })
      cache.set(url, pending)
    }
    return pending
  }
}

// ── minimal structural DOM (the package core compiles without lib: dom) ──

interface DomImage {
  naturalWidth: number
  naturalHeight: number
  onload: (() => void) | null
  onerror: (() => void) | null
  src: string
}

interface DomMediaElement {
  preload: string
  duration: number
  videoWidth: number
  videoHeight: number
  onloadedmetadata: (() => void) | null
  onerror: (() => void) | null
  src: string
}

interface DomGlobals {
  document?: { createElement: (tag: string) => DomMediaElement }
  Image?: new () => DomImage
}

function dom(): DomGlobals | null {
  const candidate = globalThis as DomGlobals
  return candidate.document && candidate.Image ? candidate : null
}

// `getMediaType` covers the image/video output kinds; audio inputs are its
// blind spot, so sniff those extensions here.
const AUDIO_URL = /\.(?:mp3|wav|m4a|aac|ogg|flac)(?:[?#]|$)/i

async function measure(url: string, kind?: string): Promise<MediaMeta | undefined> {
  // A blob/object URL carries no extension — callers that know the kind
  // (e.g. from File.type) pass it as the ref's literal type.
  if (kind === 'audio' || AUDIO_URL.test(url))
    return measureElement('audio', url)
  if (kind === 'video')
    return measureElement('video', url)
  if (kind === 'image')
    return measureImage(url)
  switch (getMediaType(url)) {
    case 'image':
      return measureImage(url)
    case 'video':
      return measureElement('video', url)
    default:
      // Unknown extension: an <img> probe is cheap and covers extensionless
      // CDN urls, which are images in this product far more often than not.
      return measureImage(url).catch(() => undefined)
  }
}

function measureImage(url: string): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const image = new (dom() as DomGlobals).Image!()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    image.src = url
  })
}

function measureElement(tag: 'video' | 'audio', url: string): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const element = (dom() as DomGlobals).document!.createElement(tag)
    element.preload = 'metadata'
    element.onloadedmetadata = () => {
      const meta: MediaMeta = { durationSec: element.duration }
      if (tag === 'video') {
        meta.width = element.videoWidth
        meta.height = element.videoHeight
      }
      element.src = '' // release the network connection
      resolve(meta)
    }
    element.onerror = () => reject(new Error(`Failed to load ${tag} metadata: ${url}`))
    element.src = url
  })
}
