import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf, promptMax, randomSeed } from './checks'
import { lookupSize } from './dimensions'
import { firstMetaSize, integerRange, requiredPromptOrRole } from './video-helpers'

export const HappyHorseAspectRatio = {
  r16x9: '16:9',
  r9x16: '9:16',
  r1x1: '1:1',
  r4x3: '4:3',
  r3x4: '3:4',
} as const

export const HappyHorseResolution = {
  r720: '720p',
  r1080: '1080p',
} as const

const ASPECT_RATIOS = Object.values(HappyHorseAspectRatio)
const RESOLUTIONS = Object.values(HappyHorseResolution)

type Ratio = typeof ASPECT_RATIOS[number]
type Resolution = typeof RESOLUTIONS[number]

const SIZE_MAP: Record<Resolution, Record<Ratio, [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:3': [960, 720], '3:4': [720, 960] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] },
}

export const happyHorse = defineJob({
  jobSetType: 'happy_horse_video',
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
      resolution: z._default(z.enum(RESOLUTIONS), '720p'),
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(ASPECT_RATIOS), '16:9')),
      duration: z._default(z.duration({ min: 3, max: 15 }), 5),
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
      seed: z.optional(z.number()),
    },
  },
  validate: input => [
    ...requiredPromptOrRole(input, 'start_image', 'Prompt is required when no image is provided'),
    ...promptMax(input.prompt, 4000),
    ...oneOf('resolution', input.settings.resolution, RESOLUTIONS),
    ...oneOf('aspectRatio', input.settings.aspectRatio, ASPECT_RATIOS),
    ...intRange('duration', input.settings.duration, 3, 15),
    ...integerRange('duration', input.settings.duration, 3, 15),
    ...intRange('batchSize', input.settings.batchSize, 1, 4),
    ...integerRange('batchSize', input.settings.batchSize, 1, 4),
  ],
  finalize: (wire, input) => {
    const measured = firstMetaSize(input.media, ['start_image'])
    const table = lookupSize(SIZE_MAP, wire.resolution as Resolution, wire.aspect_ratio as Ratio)
    return {
      ...wire,
      prompt: wire.prompt ?? '',
      seed: wire.seed ?? randomSeed(),
      width: measured?.width ?? table.width,
      height: measured?.height ?? table.height,
      medias: wire.medias ?? [],
    }
  },
})
