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

export { NanoBananaAspectRatio as NanoBanana2AspectRatio }

const MAX_PROMPT_CHARACTERS = 15_000

const CREDITS_PER_IMAGE: Record<NanoBananaResolution, number> = {
  '1k': 2,
  '2k': 2,
  '4k': 4,
}

/**
 * Nano Banana Pro. Grounded in fnf-web's `job-image-nano-banana-2` module.
 * The app submits `/jobs/nano-banana-2` with `input_images` kept as a bare
 * array. Public settings carry ONLY user generation input — the product's
 * surface/billing markers (application_slug, is_draw/is_ugc/…, use_unlim,
 * use_seedream_bonus) are not part of the SDK surface; deliberate raw wire
 * fields belong in `extra`.
 */
export const nanoBanana2 = defineJob({
  jobSetType: 'nano_banana_2',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'input_images',
      format: 'unwrapped',
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
      input_images: wire.input_images ?? [],
    }
  },
})
