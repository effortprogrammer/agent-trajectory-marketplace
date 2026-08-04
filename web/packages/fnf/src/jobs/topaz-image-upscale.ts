import type { MediaIssue } from '../groups/media'
import type { GenerationInput } from '../types'
import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf } from './checks'
import {
  imageFactorIssues,
  range,
  requirePositiveSize,
  scaleImageSize,
  stripUndefined,
  TOPAZ_IMAGE_MODELS,
  TopazImageModel,
  type TopazImageModelValue,
  UPSCALE_IMAGE_FACTORS,
  UpscaleImageFactor,
  type UpscaleImageFactorValue,
} from './upscale-helpers'
import { firstMetaSize } from './video-helpers'

function sourceSize(input: GenerationInput): { width: number, height: number } | undefined {
  const meta = firstMetaSize(input.media, ['image'])
  if (meta)
    return meta
  const settings = input.settings as { sourceWidth?: number, sourceHeight?: number }
  return settings.sourceWidth != null && settings.sourceHeight != null
    ? { width: settings.sourceWidth, height: settings.sourceHeight }
    : undefined
}

function finalizeTopazImage(wire: Record<string, unknown>, input: GenerationInput, model: TopazImageModelValue | 'Redefine'): Record<string, unknown> {
  const size = sourceSize(input)
  const factor = (wire.factor ?? 'x1') as UpscaleImageFactorValue
  const output = wire.output_width != null && wire.output_height != null
    ? { width: wire.output_width as number, height: wire.output_height as number }
    : size
      ? scaleImageSize(size, factor)
      : undefined
  const rest = { ...wire }
  delete rest.factor
  return stripUndefined({
    ...rest,
    model,
    width: size?.width,
    height: size?.height,
    output_width: output?.width,
    output_height: output?.height,
  })
}

function baseValidate(input: GenerationInput): MediaIssue[] {
  const settings = input.settings as {
    sourceWidth?: number
    sourceHeight?: number
    outputWidth?: number
    outputHeight?: number
    factor?: string
    denoise?: number
    sharpen?: number
    faceEnhancementCreativity?: number
    faceEnhancementStrength?: number
  }
  const size = sourceSize(input)
  return [
    ...requirePositiveSize('sourceSize', size),
    ...oneOf('factor', settings.factor, UPSCALE_IMAGE_FACTORS),
    ...imageFactorIssues(input.media, settings.factor),
    ...range('sourceWidth', settings.sourceWidth, 1, Number.MAX_SAFE_INTEGER),
    ...range('sourceHeight', settings.sourceHeight, 1, Number.MAX_SAFE_INTEGER),
    ...range('outputWidth', settings.outputWidth, 1, Number.MAX_SAFE_INTEGER),
    ...range('outputHeight', settings.outputHeight, 1, Number.MAX_SAFE_INTEGER),
    ...range('denoise', settings.denoise, 0, 1),
    ...range('sharpen', settings.sharpen, 0, 1),
    ...range('faceEnhancementCreativity', settings.faceEnhancementCreativity, 0, 1),
    ...range('faceEnhancementStrength', settings.faceEnhancementStrength, 0, 1),
  ]
}

const baseSettings = {
  sourceWidth: z.wire('width', z.optional(z.number())),
  sourceHeight: z.wire('height', z.optional(z.number())),
  outputWidth: z.wire('output_width', z.optional(z.number())),
  outputHeight: z.wire('output_height', z.optional(z.number())),
  factor: z._default(z.enum(UPSCALE_IMAGE_FACTORS), UpscaleImageFactor.x1),
  denoise: z._default(z.number(), 0.2),
  sharpen: z._default(z.number(), 0.3),
  faceEnhancement: z.wire('face_enhancement', z._default(z.boolean(), false)),
  faceEnhancementCreativity: z.wire('face_enhancement_creativity', z._default(z.number(), 0)),
  faceEnhancementStrength: z.wire('face_enhancement_strength', z._default(z.number(), 0.8)),
}

export { TopazImageModel, UpscaleImageFactor as TopazImageUpscaleFactor }

export const topazImageUpscale = defineJob({
  jobSetType: 'topaz_image',
  outputType: 'image',
  params: {
    media: {
      field: 'input_image',
      format: 'single',
      roles: ['image'],
      counts: { image: { min: 1, max: 1 } },
    },
    settings: {
      ...baseSettings,
      model: z._default(z.enum(TOPAZ_IMAGE_MODELS), TopazImageModel.standardV2),
    },
  },
  validate: input => [
    ...baseValidate(input),
    ...oneOf('model', input.settings.model, TOPAZ_IMAGE_MODELS),
  ],
  finalize: (wire, input) => finalizeTopazImage(wire, input, (wire.model ?? TopazImageModel.standardV2) as TopazImageModelValue),
})

export const topazImageGenerativeUpscale = defineJob({
  jobSetType: 'topaz_image_generative',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'input_image',
      format: 'single',
      roles: ['image'],
      counts: { image: { min: 1, max: 1 } },
    },
    settings: {
      ...baseSettings,
      detail: z._default(z.number(), 1),
      texture: z._default(z.number(), 1),
      creativity: z._default(z.number(), 1),
      autoprompt: z._default(z.boolean(), true),
    },
  },
  validate: input => [
    ...baseValidate(input),
    ...range('detail', input.settings.detail, 0, 1),
    ...intRange('texture', input.settings.texture, 1, 5),
    ...intRange('creativity', input.settings.creativity, 1, 6),
  ],
  finalize: (wire, input) => finalizeTopazImage(wire, input, 'Redefine'),
})
