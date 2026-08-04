import { defineJob } from '../define-job'
import { dimensionsWithin, durationsWithin } from '../groups/media'
import { z } from '../z'
import { countRefs, promptMax } from './checks'
import { firstMetaDuration, firstMetaSize, integerRange } from './video-helpers'

export const Kling3MotionControlMode = {
  std: 'std',
  pro: 'pro',
} as const

export const Kling3MotionControlOrientation = {
  image: 'image',
  video: 'video',
} as const

const MODES = Object.values(Kling3MotionControlMode)
const ORIENTATIONS = Object.values(Kling3MotionControlOrientation)
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720

export const kling3MotionControl = defineJob({
  jobSetType: 'kling3_0_motion_control',
  outputType: 'video',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['image', 'video'],
      counts: { image: { min: 1, max: 4 }, video: { min: 1, max: 1 } },
      rules: [
        dimensionsWithin(['image'], { minSide: 300, ratio: [0.4, 2.5] }),
        dimensionsWithin(['video'], { minSide: 340, maxSide: 3850, ratio: [1 / 3, 3] }),
        durationsWithin(['video'], { each: [3, 30] }),
      ],
    },
    settings: {
      mode: z._default(z.enum(MODES), 'std'),
      characterOrientation: z.wire('character_orientation', z._default(z.enum(ORIENTATIONS), 'image')),
      duration: z.optional(z.duration({ min: 3, max: 30 })),
      seed: z.optional(z.number()),
      isChain: z._default(z.boolean(), false),
      backgroundSource: z.wire('background_source', z.optional(z.string())),
    },
  },
  credits: ({ settings, media }) => {
    const duration = settings.duration ?? firstMetaDuration(media, ['video'])
    if (duration == null)
      return null
    const perSecond = settings.mode === 'pro' ? 2.5 : 1.5
    return Math.ceil(perSecond * duration + (settings.isChain ? 2 : 0))
  },
  validate: ({ prompt, media, settings }) => {
    const issues = [...promptMax(prompt, 2500)]
    if (countRefs(media, 'video') === 0)
      issues.push({ loc: ['media', 'video'], msg: 'Input Video Required' })
    if (countRefs(media, 'image') === 0)
      issues.push({ loc: ['media', 'image'], msg: 'Input Image Required' })

    const duration = settings.duration ?? firstMetaDuration(media, ['video'])
    if (duration != null)
      issues.push(...integerRange('duration', duration, 3, 30))
    return issues
  },
  finalize: (wire, input) => {
    const size = firstMetaSize(input.media, ['video', 'image'])
    const duration = wire.duration ?? firstMetaDuration(input.media, ['video'])
    return {
      ...wire,
      prompt: wire.prompt ?? '',
      width: typeof wire.width === 'number' ? wire.width : size?.width ?? DEFAULT_WIDTH,
      height: typeof wire.height === 'number' ? wire.height : size?.height ?? DEFAULT_HEIGHT,
      ...(duration != null ? { duration } : {}),
    }
  },
})
