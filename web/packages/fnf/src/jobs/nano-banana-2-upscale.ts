import { defineJob } from '../define-job'
import { atLeastOneOf } from '../groups/media'
import { z } from '../z'
import { oneOf } from './checks'
import {
  getNanoBananaDimensions,
  NANO_BANANA_ASPECT_RATIO_VALUES,
  NanoBananaAspectRatio,
  type NanoBananaResolution,
  resolveNanoBananaRatio,
} from './nano-banana-shared'

export { NanoBananaAspectRatio as NanoBanana2UpscaleAspectRatio }

const RESOLUTIONS = ['2k', '4k'] as const
type Resolution = typeof RESOLUTIONS[number]

const CREDITS: Record<Resolution, number> = {
  '2k': 2,
  '4k': 4,
}

export const nanoBanana2Upscale = defineJob({
  jobSetType: 'nano_banana_2_upscale',
  outputType: 'image',
  params: {
    media: {
      field: 'input_images',
      format: 'unwrapped',
      roles: ['image'],
      counts: { image: { min: 1 } },
      rules: [atLeastOneOf(['image'])],
    },
    settings: {
      resolution: z._default(z.enum(RESOLUTIONS), '4k'),
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(NANO_BANANA_ASPECT_RATIO_VALUES), NanoBananaAspectRatio.auto)),
    },
  },
  credits: ({ settings }) => CREDITS[settings.resolution ?? '4k'],
  validate: ({ settings }) => [
    ...oneOf('resolution', settings.resolution, RESOLUTIONS),
    ...oneOf('aspectRatio', settings.aspectRatio, NANO_BANANA_ASPECT_RATIO_VALUES),
  ],
  finalize: (wire, input) => {
    const ratio = resolveNanoBananaRatio(input, ['image'], wire.aspect_ratio as never)
    const { width, height } = getNanoBananaDimensions(wire.resolution as NanoBananaResolution, ratio)
    return {
      ...wire,
      aspect_ratio: ratio,
      width,
      height,
    }
  },
})
