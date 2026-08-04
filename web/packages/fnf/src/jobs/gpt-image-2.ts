import { defineJob } from '../define-job'
import { dimensionsWithin } from '../groups/media'
import { z } from '../z'
import { intRange, oneOf, promptRequired } from './checks'
import { firstSizeMeta } from './dimensions'
import { dimensionsFromRatios } from './image-helpers'

export const GptImage2AspectRatio = {
  auto: 'auto',
  r1x1: '1:1',
  r3x2: '3:2',
  r2x3: '2:3',
  r16x9: '16:9',
  r9x16: '9:16',
  r4x3: '4:3',
  r3x4: '3:4',
  r21x9: '21:9',
} as const

export type GptImage2AspectRatioValue = typeof GptImage2AspectRatio[keyof typeof GptImage2AspectRatio]
type ConcreteRatio = Exclude<GptImage2AspectRatioValue, 'auto'>
type Quality = 'low' | 'medium' | 'high'
type Resolution = '1k' | '2k' | '4k'

const CONCRETE_RATIOS: Record<ConcreteRatio, readonly [number, number]> = {
  '1:1': [1, 1],
  '3:2': [3, 2],
  '2:3': [2, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '21:9': [21, 9],
}

const BASE_SIZE: Record<Resolution, number> = {
  '1k': 1024,
  '2k': 2048,
  '4k': 4096,
}

const CREDITS_PER_IMAGE: Record<Quality, Record<Resolution, number>> = {
  low: { '1k': 0.5, '2k': 0.75, '4k': 1 },
  medium: { '1k': 2, '2k': 3, '4k': 6 },
  high: { '1k': 4, '2k': 7, '4k': 12 },
}

const SUB_MODELS = ['videotape-alpha', 'cassettetape-alpha', 'electricaltape-alpha', 'tidepool-alpha'] as const

function dimensionsFor(aspectRatio: GptImage2AspectRatioValue, resolution: Resolution) {
  const base = BASE_SIZE[resolution]
  if (aspectRatio === 'auto')
    return { width: base, height: base }
  return dimensionsFromRatios(CONCRETE_RATIOS, aspectRatio, base)
}

export const gptImage2 = defineJob({
  jobSetType: 'gpt_image_2',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['image'],
      counts: { image: { max: 16 } },
      rules: [dimensionsWithin(['image'], { minSide: 300, ratio: [0.4, 2.5] })],
    },
    settings: {
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(Object.values(GptImage2AspectRatio)), 'auto')),
      quality: z._default(z.enum(['low', 'medium', 'high']), 'high'),
      resolution: z._default(z.enum(['1k', '2k', '4k']), '2k'),
      subModel: z.wire('sub_model', z._default(z.enum(SUB_MODELS), 'videotape-alpha')),
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
    },
  },
  credits: ({ settings }) => {
    const quality = settings.quality ?? 'high'
    const resolution = settings.resolution ?? '2k'
    return (settings.batchSize ?? 1) * CREDITS_PER_IMAGE[quality][resolution]
  },
  validate: ({ prompt, settings }) => [
    ...promptRequired(prompt),
    ...intRange('batchSize', settings.batchSize, 1, 4),
    ...oneOf('aspectRatio', settings.aspectRatio, Object.values(GptImage2AspectRatio)),
  ],
  finalize: (wire, input) => {
    const aspectRatio = wire.aspect_ratio as GptImage2AspectRatioValue
    const resolution = (wire.resolution ?? '2k') as Resolution
    const size = aspectRatio === 'auto'
      ? firstSizeMeta(input.media, ['image']) ?? dimensionsFor(aspectRatio, resolution)
      : dimensionsFor(aspectRatio, resolution)

    return {
      ...wire,
      model: 'gpt_image_2',
      width: size.width,
      height: size.height,
    }
  },
})
