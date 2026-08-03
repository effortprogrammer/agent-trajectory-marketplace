import type { MediaIssue } from '../groups/media'
import type { GenerationInput } from '../types'
import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, oneOf } from './checks'
import {
  firstDuration,
  localBytedanceVideoCredits,
  range,
  requirePositiveSize,
  scaleVideoSize,
  stripUndefined,
  topazFixedVideoSize,
  VIDEO_SCALE_FACTORS,
  VideoScaleFactor,
  type VideoScaleFactorValue,
} from './upscale-helpers'
import { firstMetaSize, integerRange, type Size } from './video-helpers'

export const TopazVideoModel = {
  proteus: 'prob-4',
  starlightCreative: 'slc-1',
  starlightFast: 'slf-1',
  starlightPrecise: 'slp-2.5',
} as const

export const TopazVideoEnhancementModel = {
  proteus: 'prob-4',
  artemis: 'ahq-12',
  iris: 'iris-3',
  rhea: 'rhea-1',
  gaia: 'ghq-5',
  theia: 'thd-3',
  starlightCreative: 'slc-1',
  starlightFast: 'slf-1',
  starlightPrecise: 'slp-2.5',
} as const

export const TopazVideoFocusFix = {
  normal: 'Normal',
  strong: 'Strong',
} as const

export const TopazVideoParameters = {
  auto: 'auto',
  manual: 'manual',
} as const

export const TopazVideoResolution = {
  r1080: '1080p',
  r2160: '2160p',
} as const

export const BytedanceVideoUpscaleResolution = {
  r1080: '1080p',
  r2k: '2k',
  r4k: '4k',
} as const

export const BytedanceVideoUpscalePreset = {
  common: 'common',
  aigc: 'aigc',
  shortSeries: 'short_series',
  ugc: 'ugc',
  oldFilm: 'old_film',
} as const

const TOPAZ_MODELS = Object.values(TopazVideoModel)
const TOPAZ_ENHANCEMENT_MODELS = Object.values(TopazVideoEnhancementModel)
const FOCUS_FIXES = Object.values(TopazVideoFocusFix)
const PARAMETER_MODES = Object.values(TopazVideoParameters)
const TOPAZ_RESOLUTIONS = Object.values(TopazVideoResolution)
const BYTEDANCE_RESOLUTIONS = Object.values(BytedanceVideoUpscaleResolution)
const BYTEDANCE_PRESETS = Object.values(BytedanceVideoUpscalePreset)

type TopazModel = typeof TOPAZ_MODELS[number]
type EnhancementModel = typeof TOPAZ_ENHANCEMENT_MODELS[number]
type TopazResolution = typeof TOPAZ_RESOLUTIONS[number]

function videoSourceSize(input: GenerationInput, roles: readonly string[] = ['video']): Size | undefined {
  const meta = firstMetaSize(input.media, roles)
  if (meta)
    return meta
  const settings = input.settings as { sourceWidth?: number, sourceHeight?: number }
  return settings.sourceWidth != null && settings.sourceHeight != null
    ? { width: settings.sourceWidth, height: settings.sourceHeight }
    : undefined
}

function videoSourceIssues(input: GenerationInput): MediaIssue[] {
  const settings = input.settings as {
    sourceWidth?: number
    sourceHeight?: number
    outputWidth?: number
    outputHeight?: number
    scaleFactor?: string
  }
  return [
    ...requirePositiveSize('sourceSize', videoSourceSize(input)),
    ...range('sourceWidth', settings.sourceWidth, 1, Number.MAX_SAFE_INTEGER),
    ...range('sourceHeight', settings.sourceHeight, 1, Number.MAX_SAFE_INTEGER),
    ...range('outputWidth', settings.outputWidth, 1, Number.MAX_SAFE_INTEGER),
    ...range('outputHeight', settings.outputHeight, 1, Number.MAX_SAFE_INTEGER),
    ...oneOf('scaleFactor', settings.scaleFactor, VIDEO_SCALE_FACTORS),
  ]
}

function resolveVideoOutput(wire: Record<string, unknown>, source: Size): Size {
  if (wire.output_width != null && wire.output_height != null)
    return { width: wire.output_width as number, height: wire.output_height as number }
  const factor = wire.scaleFactor as VideoScaleFactorValue | undefined
  if (factor && factor !== VideoScaleFactor.original)
    return scaleVideoSize(factor, source)
  const resolution = wire.resolution as TopazResolution | undefined
  if (resolution)
    return topazFixedVideoSize(resolution)
  const model = wire.model as string | undefined
  if (model === 'slc-1' || model === 'slf-1' || model === 'slp-2.5')
    return topazFixedVideoSize('2160p')
  return source
}

function topazVideoSettings() {
  return {
    sourceWidth: z.wire('width', z.optional(z.number())),
    sourceHeight: z.wire('height', z.optional(z.number())),
    outputWidth: z.wire('output_width', z.optional(z.number())),
    outputHeight: z.wire('output_height', z.optional(z.number())),
    scaleFactor: z._default(z.enum(VIDEO_SCALE_FACTORS), VideoScaleFactor.original),
    resolution: z.optional(z.enum(TOPAZ_RESOLUTIONS)),
    model: z._default(z.enum(TOPAZ_MODELS), TopazVideoModel.starlightPrecise),
    enhancement: z._default(z.boolean(), true),
    enhancementModel: z._default(z.enum(TOPAZ_ENHANCEMENT_MODELS), TopazVideoEnhancementModel.starlightPrecise),
    focusFix: z.wire('focus_fix_level', z._default(z.enum(FOCUS_FIXES), TopazVideoFocusFix.normal)),
    parameters: z._default(z.enum(PARAMETER_MODES), TopazVideoParameters.auto),
    compression: z.optional(z.number()),
    details: z.optional(z.number()),
    preblur: z.optional(z.number()),
    blur: z.optional(z.number()),
    noise: z.optional(z.number()),
    halo: z.optional(z.number()),
    grainEnabled: z._default(z.boolean(), false),
    grainStrength: z._default(z.number(), 0.04),
    grainSize: z._default(z.number(), 0.02),
    frameInterpolation: z._default(z.boolean(), false),
    frameInterpolationFps: z._default(z.number(), 24),
    slowMotion: z._default(z.number(), 1),
  }
}

function stripTopazControlFields(wire: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...wire }
  for (const key of [
    'scaleFactor',
    'resolution',
    'enhancement',
    'enhancementModel',
    'focus_fix_level',
    'parameters',
    'compression',
    'details',
    'preblur',
    'blur',
    'noise',
    'halo',
    'grainEnabled',
    'grainStrength',
    'grainSize',
    'frameInterpolation',
    'frameInterpolationFps',
    'slowMotion',
  ]) delete rest[key]
  return rest
}

function manualParams(wire: Record<string, unknown>) {
  if (wire.parameters !== TopazVideoParameters.manual)
    return null
  return {
    compression: wire.compression ?? -0.6,
    details: wire.details ?? -0.4,
    preblur: wire.preblur ?? -1,
    blur: wire.blur ?? -0.8,
    noise: wire.noise ?? -0.7,
    halo: wire.halo ?? -1,
    grain: wire.grainEnabled === true
      ? {
          strength: wire.grainStrength ?? 0.04,
          size: wire.grainSize ?? 0.02,
        }
      : null,
  }
}

export const topazVideoUpscale = defineJob({
  jobSetType: 'topaz_video',
  outputType: 'video',
  params: {
    media: {
      field: 'input_video',
      format: 'single',
      roles: ['video'],
      counts: { video: { min: 1, max: 1 } },
    },
    settings: topazVideoSettings(),
  },
  validate: (input) => {
    const settings = input.settings as Record<string, number | string | boolean | undefined>
    return [
      ...videoSourceIssues(input),
      ...oneOf('model', settings.model, TOPAZ_MODELS),
      ...oneOf('enhancementModel', settings.enhancementModel, TOPAZ_ENHANCEMENT_MODELS),
      ...oneOf('focusFix', settings.focusFix, FOCUS_FIXES),
      ...oneOf('parameters', settings.parameters, PARAMETER_MODES),
      ...oneOf('resolution', settings.resolution, TOPAZ_RESOLUTIONS),
      ...range('compression', settings.compression as number | undefined, -1, 1),
      ...range('details', settings.details as number | undefined, -1, 1),
      ...range('preblur', settings.preblur as number | undefined, -1, 1),
      ...range('blur', settings.blur as number | undefined, -1, 1),
      ...range('noise', settings.noise as number | undefined, -1, 1),
      ...range('halo', settings.halo as number | undefined, -1, 1),
      ...range('grainStrength', settings.grainStrength as number | undefined, 0, 0.1),
      ...range('grainSize', settings.grainSize as number | undefined, 0, 0.1),
      ...(settings.frameInterpolation === true
        ? [
            ...intRange('frameInterpolationFps', settings.frameInterpolationFps as number | undefined, 15, 240),
            ...integerRange('frameInterpolationFps', settings.frameInterpolationFps as number | undefined, 15, 240),
            ...intRange('slowMotion', settings.slowMotion as number | undefined, 1, 16),
            ...integerRange('slowMotion', settings.slowMotion as number | undefined, 1, 16),
          ]
        : []),
    ]
  },
  finalize: (wire, input) => {
    const source = videoSourceSize(input)!
    const output = resolveVideoOutput(wire, source)
    const rest = stripTopazControlFields(wire)
    return stripUndefined({
      ...rest,
      width: source.width,
      height: source.height,
      output_width: output.width,
      output_height: output.height,
      model: (wire.model ?? TopazVideoModel.starlightPrecise) as TopazModel,
      enhancement: wire.enhancement === false
        ? null
        : {
            model: (wire.enhancementModel ?? TopazVideoEnhancementModel.starlightPrecise) as EnhancementModel,
            focus_fix_level: wire.focus_fix_level ?? TopazVideoFocusFix.normal,
            params: manualParams(wire),
          },
      frame_interpolation: wire.frameInterpolation === true
        ? { model: 'apo-8', fps: wire.frameInterpolationFps ?? 24, slowmo: wire.slowMotion ?? 1 }
        : null,
    })
  },
})

function simpleVideoUpscale(jobSetType: 'video_upscale' | 'video_deflicker') {
  return defineJob({
    jobSetType,
    outputType: 'video',
    params: {
      media: {
        field: 'input_video',
        format: 'single',
        roles: ['video'],
        counts: { video: { min: 1, max: 1 } },
      },
      settings: {
        sourceWidth: z.wire('width', z.optional(z.number())),
        sourceHeight: z.wire('height', z.optional(z.number())),
        outputWidth: z.wire('output_width', z.optional(z.number())),
        outputHeight: z.wire('output_height', z.optional(z.number())),
        scaleFactor: z._default(z.enum(VIDEO_SCALE_FACTORS), VideoScaleFactor.original),
      },
    },
    credits: () => 2,
    validate: videoSourceIssues,
    finalize: (wire, input) => {
      const source = videoSourceSize(input)!
      const output = wire.output_width != null && wire.output_height != null
        ? { width: wire.output_width as number, height: wire.output_height as number }
        : scaleVideoSize((wire.scaleFactor ?? VideoScaleFactor.original) as VideoScaleFactorValue, source)
      const rest = { ...wire }
      delete rest.scaleFactor
      return stripUndefined({
        ...rest,
        width: source.width,
        height: source.height,
        output_width: output.width,
        output_height: output.height,
      })
    },
  })
}

export const higgsfieldVideoUpscale = simpleVideoUpscale('video_upscale')
export const soraEnhanceVideo = simpleVideoUpscale('video_deflicker')

export const bytedanceVideoUpscale = defineJob({
  jobSetType: 'bytedance_video_upscale',
  outputType: 'video',
  params: {
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['video'],
      counts: { video: { min: 1, max: 1 } },
    },
    settings: {
      sourceWidth: z.wire('width', z.optional(z.number())),
      sourceHeight: z.wire('height', z.optional(z.number())),
      resolution: z._default(z.enum(BYTEDANCE_RESOLUTIONS), BytedanceVideoUpscaleResolution.r2k),
      preset: z._default(z.enum(BYTEDANCE_PRESETS), BytedanceVideoUpscalePreset.common),
      fps: z._default(z.number(), 24),
    },
  },
  credits: ({ settings, media }) => localBytedanceVideoCredits(settings.resolution ?? '2k', firstDuration(media, ['video']), settings.fps ?? 24),
  validate: (input) => {
    const settings = input.settings as { resolution?: string, preset?: string, fps?: number }
    return [
      ...videoSourceIssues(input),
      ...oneOf('resolution', settings.resolution, BYTEDANCE_RESOLUTIONS),
      ...oneOf('preset', settings.preset, BYTEDANCE_PRESETS),
      ...intRange('fps', settings.fps, 1, 240),
      ...integerRange('fps', settings.fps, 1, 240),
    ]
  },
  finalize: (wire, input) => {
    const source = videoSourceSize(input)!
    return stripUndefined({
      ...wire,
      width: source.width,
      height: source.height,
    })
  },
})
