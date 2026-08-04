import { defineJob } from '../define-job'
import { z } from '../z'
import { countRefs, oneOf, promptMax, promptRequired, randomSeed } from './checks'
import { lookupSize } from './dimensions'
import { firstMetaSize } from './video-helpers'

export const Veo31LiteAspectRatio = {
  auto: 'auto',
  r16x9: '16:9',
  r9x16: '9:16',
} as const

export const Veo31LiteResolution = {
  r720: '720p',
  r1080: '1080p',
} as const

const ASPECT_RATIOS = Object.values(Veo31LiteAspectRatio)
const RESOLUTIONS = Object.values(Veo31LiteResolution)

type ConcreteRatio = Exclude<typeof Veo31LiteAspectRatio[keyof typeof Veo31LiteAspectRatio], 'auto'>
type Resolution = typeof RESOLUTIONS[number]

const SIZE_MAP: Record<Resolution, Record<ConcreteRatio, [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920] },
}
const AUTO_FALLBACK = { width: 1920, height: 1080 }

export const veo3_1Lite = defineJob({
  jobSetType: 'veo3_1_lite',
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
      duration: z._default(z.duration({ values: [4, 6, 8] }), 8),
      resolution: z._default(z.enum(RESOLUTIONS), '720p'),
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(ASPECT_RATIOS), 'auto')),
      generateAudio: z.wire('generate_audio', z._default(z.boolean(), true)),
      seed: z.optional(z.number()),
    },
  },
  credits: ({ settings }) => {
    const perSecond = settings.resolution === '1080p'
      ? (settings.generateAudio ? 2 : 1.5)
      : (settings.generateAudio ? 1.5 : 1)
    return Math.ceil((settings.duration ?? 8) * perSecond)
  },
  validate: ({ prompt, media, settings }) => {
    const issues = [
      ...promptRequired(prompt),
      ...promptMax(prompt, 4000),
      ...oneOf('duration', settings.duration, [4, 6, 8]),
      ...oneOf('resolution', settings.resolution, RESOLUTIONS),
      ...oneOf('aspectRatio', settings.aspectRatio, ASPECT_RATIOS),
    ]
    const hasFLF = countRefs(media, 'start_image') > 0 && countRefs(media, 'end_image') > 0
    if (hasFLF && settings.duration !== 8)
      issues.push({ loc: ['settings', 'duration'], msg: 'Duration must be 8 seconds when both first and last frames are provided' })
    if (settings.resolution === '1080p' && settings.duration !== 8)
      issues.push({ loc: ['settings', 'duration'], msg: 'Duration must be 8 seconds for 1080p resolution' })
    return issues
  },
  finalize: (wire, input) => {
    const measured = firstMetaSize(input.media, ['start_image'])
    const table = wire.aspect_ratio === 'auto'
      ? AUTO_FALLBACK
      : lookupSize(SIZE_MAP, wire.resolution as Resolution, wire.aspect_ratio as ConcreteRatio)
    return {
      ...wire,
      seed: wire.seed ?? randomSeed(),
      width: measured?.width ?? table.width,
      height: measured?.height ?? table.height,
      medias: wire.medias ?? [],
    }
  },
})
