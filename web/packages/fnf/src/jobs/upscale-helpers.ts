import type { MediaIssue } from '../groups/media'
import type { GenerationInput, MediaInput } from '../types'
import { firstMetaSize, refsFor, type Size } from './video-helpers'

export const UpscaleImageFactor = {
  x1: 'x1',
  x2: 'x2',
  x4: 'x4',
  x8: 'x8',
  x16: 'x16',
} as const

export const UPSCALE_IMAGE_FACTORS = Object.values(UpscaleImageFactor)
export type UpscaleImageFactorValue = typeof UPSCALE_IMAGE_FACTORS[number]

export const TopazImageModel = {
  standardV2: 'Standard V2',
  lowResolutionV2: 'Low Resolution V2',
  cgi: 'CGI',
  highFidelityV2: 'High Fidelity V2',
  textRefine: 'Text Refine',
} as const

export const TOPAZ_IMAGE_MODELS = Object.values(TopazImageModel)
export type TopazImageModelValue = typeof TOPAZ_IMAGE_MODELS[number]

type UpscaleQuality = 'largest' | '8K' | '4K' | '2K' | '1080p' | '720p' | '500p'

const SCALES_BY_IMAGE_QUALITY: Record<UpscaleQuality, UpscaleImageFactorValue[]> = {
  'largest': [],
  '8K': ['x1'],
  '4K': ['x1', 'x2'],
  '2K': ['x1', 'x2', 'x4'],
  '1080p': ['x1', 'x2', 'x4', 'x8'],
  '720p': ['x1', 'x2', 'x4', 'x8'],
  '500p': ['x1', 'x2', 'x4', 'x8', 'x16'],
}

export function imageQuality(size: Size): UpscaleQuality {
  const longest = Math.max(size.width, size.height)
  if (longest >= 9000)
    return 'largest'
  if (longest >= 7680)
    return '8K'
  if (longest >= 3840)
    return '4K'
  if (longest >= 2048)
    return '2K'
  if (longest >= 1920)
    return '1080p'
  if (longest >= 1280)
    return '720p'
  return '500p'
}

export function availableImageFactors(size: Size): UpscaleImageFactorValue[] {
  return SCALES_BY_IMAGE_QUALITY[imageQuality(size)]
}

export function scaleImageSize(size: Size, factor: UpscaleImageFactorValue): Size {
  const n = Number(factor.replace('x', ''))
  return { width: size.width * n, height: size.height * n }
}

export function firstMediaSizeOrSettings(input: GenerationInput, roles: readonly string[], wire: Record<string, unknown>): Size | undefined {
  const meta = firstMetaSize(input.media, roles)
  if (meta)
    return meta
  const width = typeof wire.width === 'number' ? wire.width : undefined
  const height = typeof wire.height === 'number' ? wire.height : undefined
  return width != null && height != null ? { width, height } : undefined
}

export function requirePositiveSize(field: string, size: Size | undefined): MediaIssue[] {
  if (size && size.width > 0 && size.height > 0)
    return []
  return [{ loc: ['settings', field], msg: `${field} requires positive width and height` }]
}

export function range(field: string, value: number | null | undefined, min: number, max: number): MediaIssue[] {
  if (value == null || (value >= min && value <= max))
    return []
  return [{ loc: ['settings', field], msg: `${field} must be between ${min} and ${max}` }]
}

export function oneOfString(field: string, value: unknown, options: readonly string[]): MediaIssue[] {
  if (typeof value !== 'string' || options.includes(value))
    return []
  return [{ loc: ['settings', field], msg: `${field} must be one of: ${options.join(', ')}` }]
}

export function imageFactorIssues(media: MediaInput | undefined, factor: string | undefined): MediaIssue[] {
  const size = firstMetaSize(media, ['image'])
  if (!size || !factor)
    return []
  const available = availableImageFactors(size)
  return available.includes(factor as UpscaleImageFactorValue)
    ? []
    : [{ loc: ['settings', 'factor'], msg: `factor must be one of: ${available.join(', ') || 'none'} for this image size` }]
}

export const VideoScaleFactor = {
  original: 'Original',
  fullHd: 'FULL_HD',
  r2k: '2k',
  r4k: '4k',
} as const

export const VIDEO_SCALE_FACTORS = Object.values(VideoScaleFactor)
export type VideoScaleFactorValue = typeof VIDEO_SCALE_FACTORS[number]

const VIDEO_RESOLUTIONS: Record<Exclude<VideoScaleFactorValue, 'Original'>, Size> = {
  'FULL_HD': { width: 1920, height: 1080 },
  '2k': { width: 2048, height: 1080 },
  '4k': { width: 3840, height: 2160 },
}

export function scaleVideoSize(factor: VideoScaleFactorValue, inputSize: Size): Size {
  if (factor === 'Original' || inputSize.width <= 0 || inputSize.height <= 0)
    return inputSize
  const target = VIDEO_RESOLUTIONS[factor]
  const targetLongestSide = Math.max(target.width, target.height)
  const aspect = inputSize.width / inputSize.height
  if (inputSize.width >= inputSize.height) {
    const width = targetLongestSide
    return { width, height: Math.round(width / aspect) }
  }
  const height = targetLongestSide
  return { width: Math.round(height * aspect), height }
}

export function topazFixedVideoSize(resolution: '1080p' | '2160p'): Size {
  return resolution === '2160p' ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 }
}

export function firstDuration(media: MediaInput | undefined, roles: readonly string[]): number | undefined {
  for (const role of roles) {
    for (const ref of refsFor(media, role)) {
      const duration = ref.meta?.durationSec
      if (duration != null)
        return duration
    }
  }
  return undefined
}

export function localBytedanceVideoCredits(resolution: '1080p' | '2k' | '4k', duration: number | undefined, fps: number): number | null {
  if (duration == null)
    return null
  const rates = fps > 30
    ? { '1080p': 0.04, '2k': 0.08, '4k': 0.16 }
    : { '1080p': 0.02, '2k': 0.04, '4k': 0.08 }
  return Math.ceil(duration * rates[resolution])
}

export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined)
      out[key] = item
  }
  return out as T
}
