import { defineJob } from '../define-job'
import { dimensionsWithin } from '../groups/media'
import { z } from '../z'
import { intRange, oneOf, promptMax, promptRequired } from './checks'
import {
  getNanoBananaDimensions,
  NANO_BANANA_ASPECT_RATIO_VALUES,
  NanoBananaAspectRatio,
  type NanoBananaResolution,
  resolveNanoBananaRatio,
} from './nano-banana-shared'

export { NanoBananaAspectRatio as NanoBananaFlashAspectRatio }

const MAX_PROMPT_CHARACTERS = 15_000

const CREDITS_PER_IMAGE: Record<NanoBananaResolution, number> = {
  '1k': 1.5,
  '2k': 2,
  '4k': 3,
}

/**
 * Nano Banana 2. Grounded in fnf-web's `job-image-nano-banana-flash` module.
 * This is separate from Nano Banana Pro: it posts to `/jobs/v2/nano_banana_flash`
 * and uses wrapped `medias` rather than bare `input_images`.
 */
export const nanoBananaFlash = defineJob({
  jobSetType: 'nano_banana_flash',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['image'],
      counts: { image: { max: 14 } },
      rules: [dimensionsWithin(['image'], { minSide: 128 })],
    },
    settings: {
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(NANO_BANANA_ASPECT_RATIO_VALUES), '3:4')),
      resolution: z._default(z.enum(['1k', '2k', '4k']), '1k'),
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
    },
  },
  credits: ({ settings }) => (settings.batchSize ?? 1) * CREDITS_PER_IMAGE[settings.resolution ?? '1k'],
  validate: ({ prompt, settings }) => [
    ...promptRequired(prompt, 2),
    ...promptMax(prompt, MAX_PROMPT_CHARACTERS, { inclusive: true }),
    ...intRange('batchSize', settings.batchSize, 1, 4),
    ...oneOf('aspectRatio', settings.aspectRatio, NANO_BANANA_ASPECT_RATIO_VALUES),
  ],
  finalize: (wire, input) => {
    const ratio = resolveNanoBananaRatio(input, ['image'], wire.aspect_ratio as never)
    const { width, height } = getNanoBananaDimensions((wire.resolution ?? '1k') as NanoBananaResolution, ratio)
    return {
      ...wire,
      aspect_ratio: ratio,
      width,
      height,
    }
  },
})
