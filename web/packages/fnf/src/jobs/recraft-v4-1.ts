import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf, promptMax, promptRequired } from './checks'
import { dimensionsFromRatios } from './image-helpers'

export const RecraftV41Model = {
  standard: 'recraft-v4-1',
  vector: 'recraft-v4-1-vector',
  utility: 'recraft-v4-1-utility',
  utilityVector: 'recraft-v4-1-utility-vector',
} as const

export const RecraftV41ModelType = {
  standard: 'standard',
  vector: 'vector',
  utility: 'utility',
  utilityVector: 'utility_vector',
} as const

export const RecraftV41AspectRatio = {
  r1x1: '1:1',
  r3x4: '3:4',
  r4x3: '4:3',
  r4x5: '4:5',
  r5x4: '5:4',
  r3x2: '3:2',
  r2x3: '2:3',
  r16x9: '16:9',
  r9x16: '9:16',
} as const

type RecraftModel = typeof RecraftV41Model[keyof typeof RecraftV41Model]
type RecraftModelType = typeof RecraftV41ModelType[keyof typeof RecraftV41ModelType]
type RecraftAspectRatio = typeof RecraftV41AspectRatio[keyof typeof RecraftV41AspectRatio]
type Resolution = '1k' | '2k'

const MODEL_TO_TYPE: Record<RecraftModel, RecraftModelType> = {
  'recraft-v4-1': 'standard',
  'recraft-v4-1-vector': 'vector',
  'recraft-v4-1-utility': 'utility',
  'recraft-v4-1-utility-vector': 'utility_vector',
}

const TYPE_TO_MODEL: Record<RecraftModelType, RecraftModel> = {
  standard: 'recraft-v4-1',
  vector: 'recraft-v4-1-vector',
  utility: 'recraft-v4-1-utility',
  utility_vector: 'recraft-v4-1-utility-vector',
}

const ASPECT_RATIOS: Record<RecraftAspectRatio, readonly [number, number]> = {
  '1:1': [1, 1],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '4:5': [4, 5],
  '5:4': [5, 4],
  '3:2': [3, 2],
  '2:3': [2, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
}

const BASE_SIZE: Record<Resolution, number> = {
  '1k': 1024,
  '2k': 2048,
}

const CREDITS_PER_IMAGE: Record<RecraftModelType, Record<Resolution, number>> = {
  standard: { '1k': 1.25, '2k': 8 },
  utility: { '1k': 1.25, '2k': 8 },
  vector: { '1k': 2.5, '2k': 10 },
  utility_vector: { '1k': 2.5, '2k': 10 },
}

const MAX_PROMPT_CHARACTERS = 3_000
const MAX_PALETTE_COLORS = 10

function modelTypeFor(model: RecraftModel, explicit?: RecraftModelType): RecraftModelType {
  return explicit ?? MODEL_TO_TYPE[model]
}

export const recraftV41Image = defineJob({
  jobSetType: 'recraft_v4_1',
  outputType: 'image',
  params: {
    prompt: true,
    settings: {
      model: z._default(z.enum(Object.values(RecraftV41Model)), 'recraft-v4-1'),
      modelType: z.wire('model_type', z.optional(z.enum(Object.values(RecraftV41ModelType)))),
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(Object.values(RecraftV41AspectRatio)), '1:1')),
      resolution: z._default(z.enum(['1k', '2k']), '1k'),
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
      colors: z.optional(z.array(z.string())),
      backgroundColor: z.wire('background_color', z.optional(z.nullable(z.string()))),
    },
  },
  credits: ({ settings }) => {
    const model = settings.model ?? 'recraft-v4-1'
    const modelType = modelTypeFor(model, settings.modelType)
    const resolution = settings.resolution ?? '1k'
    return (settings.batchSize ?? 1) * CREDITS_PER_IMAGE[modelType][resolution]
  },
  validate: ({ prompt, settings }) => {
    const model = settings.model ?? 'recraft-v4-1'
    const modelType = modelTypeFor(model, settings.modelType)
    const resolution = settings.resolution ?? '1k'
    const issues = [
      ...promptRequired(prompt),
      ...promptMax(prompt, MAX_PROMPT_CHARACTERS),
      ...intRange('batchSize', settings.batchSize, 1, 4),
      ...oneOf('aspectRatio', settings.aspectRatio, Object.values(RecraftV41AspectRatio)),
    ]
    if (settings.modelType && settings.modelType !== MODEL_TO_TYPE[model]) {
      issues.push({
        loc: ['settings', 'modelType'],
        msg: `modelType '${settings.modelType}' does not match model '${model}'`,
      })
    }
    if ((settings.colors?.length ?? 0) > MAX_PALETTE_COLORS) {
      issues.push({
        loc: ['settings', 'colors'],
        msg: `Color palette can include up to ${MAX_PALETTE_COLORS} colors`,
      })
    }
    if (!CREDITS_PER_IMAGE[modelType]?.[resolution]) {
      issues.push({
        loc: ['settings', 'modelType'],
        msg: `modelType '${modelType}' is not supported`,
      })
    }
    return issues
  },
  finalize: (wire) => {
    const model = (wire.model ?? 'recraft-v4-1') as RecraftModel
    const modelType = modelTypeFor(model, wire.model_type as RecraftModelType | undefined)
    const aspectRatio = (wire.aspect_ratio ?? '1:1') as RecraftAspectRatio
    const resolution = (wire.resolution ?? '1k') as Resolution
    const { width, height } = dimensionsFromRatios(ASPECT_RATIOS, aspectRatio, BASE_SIZE[resolution])
    const rest = { ...wire }
    delete rest.model

    return {
      ...rest,
      model_type: modelType,
      width,
      height,
    }
  },
  restore: (wire) => {
    const modelType = typeof wire.model_type === 'string' ? wire.model_type as RecraftModelType : undefined
    return modelType && TYPE_TO_MODEL[modelType]
      ? { model: TYPE_TO_MODEL[modelType] }
      : {}
  },
})
