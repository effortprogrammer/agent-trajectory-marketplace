import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf, promptRequired, randomSeed } from './checks'
import { lookupSize } from './dimensions'
import { integerRange } from './video-helpers'

export const Wan27AspectRatio = {
  r16x9: '16:9',
  r9x16: '9:16',
  r4x3: '4:3',
  r3x4: '3:4',
  r1x1: '1:1',
} as const

export const Wan27Quality = {
  r720: '720p',
  r1080: '1080p',
} as const

const ASPECT_RATIOS = Object.values(Wan27AspectRatio)
const QUALITIES = Object.values(Wan27Quality)

type Ratio = typeof ASPECT_RATIOS[number]
type Quality = typeof QUALITIES[number]

const SIZE_MAP: Record<Quality, Record<Ratio, [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [960, 720], '3:4': [720, 960], '1:1': [720, 720] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '4:3': [1440, 1080], '3:4': [1080, 1440], '1:1': [1080, 1080] },
}

export const wan27 = defineJob({
  jobSetType: 'wan2_7',
  outputType: 'video',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['start_image', 'end_image'],
      counts: { start_image: { max: 1 }, end_image: { max: 1 } },
    },
    settings: {
      seed: z.optional(z.number()),
      quality: z._default(z.enum(QUALITIES), '720p'),
      duration: z._default(z.duration({ min: 2, max: 15 }), 5),
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(ASPECT_RATIOS), '16:9')),
    },
  },
  credits: ({ settings }) => Math.ceil((settings.duration ?? 5) * (settings.quality === '1080p' ? 2.5 : 1.5)),
  validate: ({ prompt, settings }) => [
    ...promptRequired(prompt),
    ...oneOf('quality', settings.quality, QUALITIES),
    ...oneOf('aspectRatio', settings.aspectRatio, ASPECT_RATIOS),
    ...intRange('duration', settings.duration, 2, 15),
    ...integerRange('duration', settings.duration, 2, 15),
    ...intRange('seed', settings.seed, 1, 2_147_483_646),
    ...integerRange('seed', settings.seed, 1, 2_147_483_646),
  ],
  finalize: (wire) => {
    const quality = wire.quality as Quality
    const { width, height } = lookupSize(SIZE_MAP, quality, wire.aspect_ratio as Ratio)
    return {
      ...wire,
      seed: wire.seed ?? randomSeed(),
      width,
      height,
      input_images: [],
      resolution: quality,
      medias: wire.medias ?? [],
    }
  },
  restore: wire => ({
    ...(typeof wire.resolution === 'string' && wire.quality == null ? { quality: wire.resolution } : {}),
  }),
})
