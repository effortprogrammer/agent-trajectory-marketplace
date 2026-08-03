import type { GenerationInput } from '../types'
import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf, promptMax, promptRequired } from './checks'
import { closestRatioBySize, lookupSize } from './dimensions'
import { firstMetaSize, integerRange } from './video-helpers'

export const GrokImagineAspectRatio = {
  auto: 'auto',
  r16x9: '16:9',
  r9x16: '9:16',
  r4x3: '4:3',
  r3x4: '3:4',
  r3x2: '3:2',
  r2x3: '2:3',
  r1x1: '1:1',
} as const

export const GrokImagineResolution = {
  r480: '480p',
  r720: '720p',
} as const

const ASPECT_RATIOS = Object.values(GrokImagineAspectRatio)
const CONCRETE_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '3:2', '2:3'] as const
const RESOLUTIONS = Object.values(GrokImagineResolution)

type Ratio = typeof CONCRETE_RATIOS[number]
type Resolution = typeof RESOLUTIONS[number]

const SIZE_MAP: Record<Resolution, Record<Ratio, [number, number]>> = {
  '480p': {
    '16:9': [854, 480],
    '4:3': [640, 480],
    '1:1': [480, 480],
    '3:4': [480, 640],
    '9:16': [480, 854],
    '3:2': [720, 480],
    '2:3': [480, 720],
  },
  '720p': {
    '16:9': [1280, 720],
    '4:3': [960, 720],
    '1:1': [720, 720],
    '3:4': [720, 960],
    '9:16': [720, 1280],
    '3:2': [1080, 720],
    '2:3': [720, 1080],
  },
}

function resolveGrokRatio(input: GenerationInput, aspectRatio: string | undefined): Ratio {
  if (aspectRatio && aspectRatio !== 'auto')
    return aspectRatio as Ratio
  const measured = firstMetaSize(input.media, ['start_image'])
  return measured ? closestRatioBySize(CONCRETE_RATIOS, measured) : '16:9'
}

export const grokImagine = defineJob({
  jobSetType: 'grok_video',
  outputType: 'video',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['start_image'],
      counts: { start_image: { max: 1 } },
    },
    settings: {
      duration: z._default(z.duration({ min: 1, max: 15 }), 6),
      resolution: z._default(z.enum(RESOLUTIONS), '720p'),
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(ASPECT_RATIOS), 'auto')),
    },
  },
  credits: ({ settings }) => Math.ceil((settings.duration ?? 6) * 1.5),
  validate: ({ prompt, settings }) => [
    ...promptRequired(prompt),
    ...promptMax(prompt, 2500),
    ...intRange('duration', settings.duration, 1, 15),
    ...integerRange('duration', settings.duration, 1, 15),
    ...oneOf('resolution', settings.resolution, RESOLUTIONS),
    ...oneOf('aspectRatio', settings.aspectRatio, ASPECT_RATIOS),
  ],
  finalize: (wire, input) => {
    const ratio = resolveGrokRatio(input, wire.aspect_ratio as string)
    const { width, height } = lookupSize(SIZE_MAP, wire.resolution as Resolution, ratio)
    return {
      ...wire,
      aspect_ratio: ratio,
      width,
      height,
      medias: wire.medias ?? [],
    }
  },
})

export const grokImagineV15 = defineJob({
  jobSetType: 'grok_video_v15',
  outputType: 'video',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['start_image'],
      counts: { start_image: { min: 1, max: 1 } },
    },
    settings: {
      duration: z._default(z.duration({ min: 2, max: 15 }), 6),
      resolution: z._default(z.enum(RESOLUTIONS), '720p'),
    },
  },
  credits: ({ settings }) => {
    const duration = Math.max(settings.duration ?? 6, 2)
    return duration * (settings.resolution === '720p' ? 4.5 : 2.5)
  },
  validate: ({ prompt, settings }) => [
    ...promptRequired(prompt),
    ...promptMax(prompt, 2500),
    ...intRange('duration', settings.duration, 2, 15),
    ...integerRange('duration', settings.duration, 2, 15),
    ...oneOf('resolution', settings.resolution, RESOLUTIONS),
  ],
  finalize: (wire, input) => {
    const ratio = resolveGrokRatio(input, 'auto')
    const { width, height } = lookupSize(SIZE_MAP, wire.resolution as Resolution, ratio)
    return {
      ...wire,
      duration: Math.max(wire.duration as number, 2),
      aspect_ratio: 'auto',
      width,
      height,
      medias: wire.medias ?? [],
    }
  },
})
