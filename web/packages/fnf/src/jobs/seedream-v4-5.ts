import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf, promptMax, promptRequired, randomSeed } from './checks'
import { firstSizeMeta } from './dimensions'

export const SeedreamV4_5AspectRatio = {
  r1x1: '1:1',
  r4x3: '4:3',
  r16x9: '16:9',
  r3x2: '3:2',
  r21x9: '21:9',
  r3x4: '3:4',
  r9x16: '9:16',
  r2x3: '2:3',
} as const

type Quality = 'basic' | 'high'

const MAX_PROMPT_CHARACTERS = 3_000

/**
 * Seedream 4.5. Grounded in fnf-web's `job-image-seedream-v4-5` module.
 * The app derives width/height from the first input image when present,
 * otherwise it submits a 1024x1024 default.
 */
export const seedreamV4_5 = defineJob({
  jobSetType: 'seedream_v4_5',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'input_images',
      format: 'unwrapped',
      roles: ['image'],
      counts: { image: { max: 14 } },
    },
    settings: {
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(Object.values(SeedreamV4_5AspectRatio)), '3:4')),
      quality: z._default(z.enum(['basic', 'high']), 'basic'),
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
      // The backend requires params.seed (422 'Field required' without it) —
      // default a random one like the product form does.
      seed: z._default(z.number(), randomSeed),
    },
  },
  credits: ({ settings }) => settings.batchSize ?? 1,
  validate: ({ prompt, settings }) => [
    ...promptRequired(prompt),
    ...promptMax(prompt, MAX_PROMPT_CHARACTERS),
    ...intRange('batchSize', settings.batchSize, 1, 4),
    ...intRange('seed', settings.seed, 1, 1_000_000),
    ...oneOf('aspectRatio', settings.aspectRatio, Object.values(SeedreamV4_5AspectRatio)),
  ],
  finalize: (wire, input) => {
    const size = firstSizeMeta(input.media, ['image']) ?? { width: 1024, height: 1024 }
    return {
      ...wire,
      model: 'seedream_v4_5',
      width: size.width,
      height: size.height,
      input_images: wire.input_images ?? [],
    }
  },
})

export type SeedreamV4_5Quality = Quality
