import { defineJob } from '../define-job'
import { dimensionsWithin } from '../groups/media'
import { z } from '../z'
import { countRefs, intRange, oneOf, promptMax } from './checks'
import { closestRatioBySize, lookupSize } from './dimensions'
import { extractAngleRefIds, firstMetaSize, integerRange } from './video-helpers'

export const Kling3AspectRatio = {
  r16x9: '16:9',
  r9x16: '9:16',
  r1x1: '1:1',
} as const

export const Kling3Mode = {
  std: 'std',
  pro: 'pro',
  k4: '4k',
} as const

export const Kling3Sound = {
  on: 'on',
  off: 'off',
} as const

const ASPECT_RATIOS = Object.values(Kling3AspectRatio)
const MODES = Object.values(Kling3Mode)
const SOUNDS = Object.values(Kling3Sound)
const SHOT_PROMPT_MAX = 512
const NORMAL_PROMPT_MAX = 2500
const MAX_SHOTS = 6
const MAX_ELEMENTS = 3
const MIN_SHOT_DURATION = 1
const MIN_TOTAL_DURATION = 3

type Kling3Ratio = typeof ASPECT_RATIOS[number]
type Kling3ModeValue = typeof MODES[number]

const SIZE_MAP: Record<Kling3ModeValue, Record<Kling3Ratio, [number, number]>> = {
  'std': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] },
  'pro': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] },
  '4k': { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2160, 2160] },
}

const multiPromptSchema = z.array(z.object({
  prompt: z.string(),
  duration: z.number(),
}))

export const kling3_0 = defineJob({
  jobSetType: 'kling3_0',
  outputType: 'video',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['start_image', 'end_image'],
      counts: { start_image: { max: 1 }, end_image: { max: 1 } },
      rules: [dimensionsWithin(['start_image', 'end_image'], { minSide: 300, ratio: [0.4, 2.5] })],
    },
    settings: {
      aspectRatio: z.wire('aspect_ratio', z._default(z.aspectRatio(ASPECT_RATIOS), '16:9')),
      mode: z._default(z.enum(MODES), 'std'),
      sound: z._default(z.enum(SOUNDS), 'off'),
      duration: z.duration({ min: 3, max: 15 }),
      multiShots: z.wire('multi_shots', z._default(z.boolean(), false)),
      multiShotMode: z.wire('multi_shot_mode', z._default(z.enum(['auto', 'custom']), 'auto')),
      multiPrompt: z.wire('multi_prompt', z.optional(multiPromptSchema)),
      klingElementIds: z.wire('kling_element_ids', z.optional(z.array(z.string()))),
    },
  },
  credits: ({ settings }) => {
    if (settings.mode !== '4k')
      return null
    const duration = settings.multiShots && settings.multiShotMode === 'custom' && settings.multiPrompt?.length
      ? settings.multiPrompt.reduce((sum, shot) => sum + (shot.duration || 0), 0)
      : settings.duration
    return Math.ceil(duration * 6)
  },
  validate: ({ prompt, media, settings }) => {
    const issues = [
      ...oneOf('aspectRatio', settings.aspectRatio, ASPECT_RATIOS),
      ...oneOf('mode', settings.mode, MODES),
      ...oneOf('sound', settings.sound, SOUNDS),
      ...intRange('duration', settings.duration, 3, 15),
      ...integerRange('duration', settings.duration, 3, 15),
      ...promptMax(prompt, NORMAL_PROMPT_MAX),
    ]

    const text = prompt?.instruction ?? ''
    const hasStart = countRefs(media, 'start_image') > 0
    const hasEnd = countRefs(media, 'end_image') > 0
    const multiShots = settings.multiShots ?? false
    const multiPrompt = settings.multiPrompt ?? []
    const elementIds = settings.klingElementIds ?? []
    const canSkipPrompt = (prompt?.enhance ?? true) && hasStart && !multiShots
    const promptRequired = !multiShots || settings.multiShotMode === 'auto'

    if (/<<<[^>]+>>>/.test(text) && !hasStart)
      issues.push({ loc: ['media', 'start_image'], msg: 'Start frame is required when prompt contains element references' })
    if (hasEnd && !hasStart)
      issues.push({ loc: ['media', 'start_image'], msg: 'Start frame is required when end frame is provided' })
    if (hasStart && hasEnd && multiShots)
      issues.push({ loc: ['media', 'end_image'], msg: 'End frame cannot be used with multi-shots' })
    if (elementIds.length > 0 && !hasStart)
      issues.push({ loc: ['media', 'start_image'], msg: 'Start frame is required for elements' })
    if (promptRequired && !canSkipPrompt && text.length === 0)
      issues.push({ loc: ['prompt'], msg: 'Prompt is required' })

    if (multiShots && settings.multiShotMode === 'custom') {
      if (multiPrompt.length === 0)
        issues.push({ loc: ['settings', 'multiPrompt'], msg: 'Multi-shot prompt is required when multi-shot mode is custom' })
      if (multiPrompt.length > MAX_SHOTS)
        issues.push({ loc: ['settings', 'multiPrompt'], msg: `Multi-shot supports up to ${MAX_SHOTS} shots` })

      let totalDuration = 0
      for (const shot of multiPrompt) {
        const shotPrompt = shot.prompt ?? ''
        totalDuration += shot.duration || 0
        if (shotPrompt.length === 0)
          issues.push({ loc: ['settings', 'multiPrompt'], msg: 'Each shot must have a prompt' })
        if (shotPrompt.length > SHOT_PROMPT_MAX)
          issues.push({ loc: ['settings', 'multiPrompt'], msg: `Shot prompt is too long (max ${SHOT_PROMPT_MAX})` })
        if (!shot.duration || shot.duration < MIN_SHOT_DURATION)
          issues.push({ loc: ['settings', 'multiPrompt'], msg: `Each shot must have at least ${MIN_SHOT_DURATION}s duration` })
      }
      if (multiPrompt.length > 0 && totalDuration < MIN_TOTAL_DURATION)
        issues.push({ loc: ['settings', 'multiPrompt'], msg: `Total duration must be at least ${MIN_TOTAL_DURATION}s` })
      if (totalDuration > 15)
        issues.push({ loc: ['settings', 'multiPrompt'], msg: 'Total duration must be at most 15s' })
      if (!hasStart && multiPrompt.some(shot => /<<<[^>]+>>>/.test(shot.prompt || '')))
        issues.push({ loc: ['media', 'start_image'], msg: 'Start frame is required when prompt contains element references' })
    }

    const refs = multiShots && multiPrompt.length
      ? multiPrompt.flatMap(shot => extractAngleRefIds(shot.prompt || ''))
      : extractAngleRefIds(text)
    if (new Set(refs).size > MAX_ELEMENTS || elementIds.length > MAX_ELEMENTS)
      issues.push({ loc: ['settings', 'klingElementIds'], msg: `Too many elements (max ${MAX_ELEMENTS}). Please remove some elements from your prompt.` })

    return issues
  },
  finalize: (wire, input) => {
    const measured = firstMetaSize(input.media, ['start_image'])
    const ratio = measured ? closestRatioBySize(ASPECT_RATIOS, measured) : wire.aspect_ratio as Kling3Ratio
    const { width, height } = lookupSize(SIZE_MAP, wire.mode as Kling3ModeValue, ratio)
    return {
      ...wire,
      prompt: wire.multi_shots && wire.multi_shot_mode === 'custom' ? '' : wire.prompt ?? '',
      aspect_ratio: ratio,
      width,
      height,
      enhance_prompt: wire.multi_shots ? false : wire.enhance_prompt,
      kling_element_ids: wire.kling_element_ids ?? [],
      duration: wire.multi_shots && wire.multi_shot_mode === 'custom' && Array.isArray(wire.multi_prompt) && wire.multi_prompt.length > 0
        ? wire.multi_prompt.reduce((sum, shot) => sum + (((shot as { duration?: number }).duration) || 0), 0)
        : wire.duration,
    }
  },
})
