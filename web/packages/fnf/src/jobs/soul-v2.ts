import { defineJob } from '../define-job'
import { dimensionsWithin } from '../groups/media'
import { z } from '../z'
import { intRange, oneOf, randomSeed } from './checks'
import { lookupSize } from './dimensions'

export const DEFAULT_SOUL_V2_STYLE_ID = '3db34ab5-3439-4317-9e03-08dc30852e69'
export const DEFAULT_SOUL_CINEMA_STYLE_ID = '5fbabfac-d27b-4751-b550-fea356ed55ac'
export const DEFAULT_SOUL_CINEMA_OLZHAS_STYLE_ID = '08307202-efcd-4ac3-b0d5-6f29c63d0a1b'

export const SoulV2AspectRatio = {
  r9x16: '9:16',
  r3x4: '3:4',
  r2x3: '2:3',
  r1x1: '1:1',
  r4x3: '4:3',
  r16x9: '16:9',
  r3x2: '3:2',
  r21x9: '21:9',
} as const

type SoulV2AspectRatioValue = typeof SoulV2AspectRatio[keyof typeof SoulV2AspectRatio]
type Quality = '720p' | '1080p'

const SIZE_MAP: Record<Quality, Record<SoulV2AspectRatioValue, [number, number]>> = {
  '1080p': { '9:16': [1152, 2048], '16:9': [2048, 1152], '4:3': [2048, 1536], '3:4': [1536, 2048], '1:1': [2048, 2048], '2:3': [1344, 2016], '3:2': [2016, 1344], '21:9': [2528, 1088] },
  '720p': { '9:16': [960, 1696], '1:1': [1536, 1536], '4:3': [1536, 1152], '16:9': [1696, 960], '3:4': [1152, 1536], '2:3': [1088, 1632], '3:2': [1632, 1088], '21:9': [1680, 720] },
}

const DENOISE_DEFAULT = 0.83

function getSoulV2Dimensions(quality: Quality, aspectRatio: SoulV2AspectRatioValue) {
  return lookupSize(SIZE_MAP, quality, aspectRatio)
}

// Public settings carry ONLY user generation input. The product's internal
// pipeline constants (use_refiner/use_green/lora/chain_enhancer/model_version)
// are injected in `finalize` below with the exact values the product always
// sends; surface/billing markers (use_unlim, is_custom, full_name,
// is_marketing_studio_avatar, use_noise, use_green_aidar) are not part of the
// SDK surface — deliberate raw wire fields belong in `extra`.
function soulV2BaseSettings(defaultStyleId: string, defaultAspectRatio: SoulV2AspectRatioValue, customReferenceStrength: number | null) {
  return {
    styleId: z.wire('style_id', z._default(z.string(), defaultStyleId)),
    styleStrength: z.wire('style_strength', z._default(z.number(), 1)),
    customReferenceId: z.wire('custom_reference_id', z.optional(z.string())),
    customReferenceStrength: z.wire('custom_reference_strength', z._default(z.nullable(z.number()), customReferenceStrength)),
    quality: z._default(z.enum(['720p', '1080p']), '1080p'),
    aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(Object.values(SoulV2AspectRatio)), defaultAspectRatio)),
    seed: z._default(z.number(), randomSeed),
    batchSize: z.wire('batch_size', z._default(z.number(), 1)),
    colorPresetId: z.wire('color_preset_id', z.optional(z.nullable(z.string()))),
  }
}

// The pipeline constants the product submits on every soul request — kept on
// the wire (NOT public settings) so the backend pipeline selection does not
// silently change. Values mirror fnf-web's soul submitters byte-for-byte.
const SOUL_PIPELINE_WIRE = {
  use_refiner: false,
  use_green: true,
  lora: null,
  chain_enhancer: null,
  model_version: 'fast',
} as const

function commonSoulV2Validate(settings: { batchSize?: number, seed?: number, aspectRatio?: string }) {
  return [
    ...intRange('batchSize', settings.batchSize, 1, 4),
    ...intRange('seed', settings.seed, 1, 1_000_000),
    ...oneOf('aspectRatio', settings.aspectRatio, Object.values(SoulV2AspectRatio)),
  ]
}

export const soulV2Image = defineJob({
  jobSetType: 'text2image_soul_v2',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['image'],
      counts: { image: { max: 1 } },
      rules: [dimensionsWithin(['image'], { minSide: 128 })],
    },
    settings: soulV2BaseSettings(DEFAULT_SOUL_V2_STYLE_ID, '3:4', 1),
  },
  credits: ({ settings }) => (settings.batchSize ?? 1) * 0.125,
  validate: ({ settings }) => commonSoulV2Validate(settings),
  finalize: (wire) => {
    const quality = (wire.quality ?? '1080p') as Quality
    const aspectRatio = (wire.aspect_ratio ?? '3:4') as SoulV2AspectRatioValue
    const { width, height } = getSoulV2Dimensions(quality, aspectRatio)
    return {
      ...SOUL_PIPELINE_WIRE,
      ...wire,
      model: 'soul_v2',
      prompt: wire.prompt ?? '',
      width,
      height,
      aspect_ratio: aspectRatio,
      medias: wire.medias ?? [],
      enhance_prompt: wire.enhance_prompt ?? false,
      negative_prompt: wire.negative_prompt ?? '',
    }
  },
})

export const soulCinemaImage = defineJob({
  jobSetType: 'soul_cinematic',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['image'],
      counts: { image: { max: 1 } },
      rules: [dimensionsWithin(['image'], { minSide: 128 })],
    },
    settings: {
      ...soulV2BaseSettings(DEFAULT_SOUL_CINEMA_STYLE_ID, '16:9', null),
      cinematicVariant: z._default(z.enum(['default', 'olzhas', 'sultan', 'aidar']), 'default'),
    },
  },
  credits: ({ settings }) => (settings.batchSize ?? 1) * 0.125,
  validate: ({ settings }) => commonSoulV2Validate(settings),
  finalize: (wire) => {
    const quality = (wire.quality ?? '1080p') as Quality
    const aspectRatio = (wire.aspect_ratio ?? '16:9') as SoulV2AspectRatioValue
    // The backend types custom_reference_strength as float (not nullable) —
    // omit it entirely when there is no custom reference.
    if (wire.custom_reference_strength == null)
      delete wire.custom_reference_strength
    const { width, height } = getSoulV2Dimensions(quality, aspectRatio)
    const batchSize = typeof wire.batch_size === 'number' ? wire.batch_size : 1
    const denoise = Array(batchSize).fill(DENOISE_DEFAULT)
    const cinematicVariant = wire.cinematicVariant
    const hasImageReference = Array.isArray(wire.medias) && wire.medias.length > 0
    const rest = { ...wire }
    delete rest.cinematicVariant

    return {
      ...SOUL_PIPELINE_WIRE,
      ...rest,
      model: 'soul_cinematic',
      prompt: hasImageReference ? '' : wire.prompt ?? '',
      width,
      height,
      aspect_ratio: aspectRatio,
      medias: wire.medias ?? [],
      enhance_prompt: wire.enhance_prompt ?? true,
      negative_prompt: wire.negative_prompt ?? '',
      model_version: 'fast',
      chain_enhancer: null,
      time_denoise_from: denoise,
      ...(cinematicVariant === 'olzhas' ? { use_olzhas: true } : {}),
      ...(cinematicVariant === 'sultan' ? { use_sultan: true } : {}),
      ...(cinematicVariant === 'aidar' ? { use_aidar: true } : {}),
    }
  },
})
