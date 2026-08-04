import { defineJob } from '../define-job'
import { dimensionsWithin, durationsWithin, maxTotal, requiresOneOf } from '../groups/media'
import { z } from '../z'
import { countRefs, intRange, oneOf } from './checks'
import { closestRatioBySize, firstSizeMeta, lookupSize } from './dimensions'

/** Allowed aspect ratios as a named, refactorable object enum (erased at runtime). */
export const Seedance2AspectRatio = {
  auto: 'auto',
  r21x9: '21:9',
  r16x9: '16:9',
  r4x3: '4:3',
  r1x1: '1:1',
  r3x4: '3:4',
  r9x16: '9:16',
} as const

const MAX_PROMPT_CHARACTERS = 40_000 // fnf-web SEEDANCE_2_0_MAX_PROMPT_CHARACTERS
const FRAME_ROLES = ['start_image', 'end_image'] as const
const IMAGE_ROLES = ['image', 'start_image', 'end_image'] as const
// Iteration order mirrors the product's ASPECT_RATIO_VALUES (dimentions.ts) —
// closestRatioBySize is first-wins on ties, so order is part of the contract.
const CONCRETE_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const

type ConcreteRatio = typeof CONCRETE_RATIOS[number]
type Resolution = '480p' | '720p' | '1080p'

/**
 * Mirrors fnf-web's seedance-2-0 dimension table (job-video-seedance2-0/model/
 * dimentions.ts). The wire wants explicit width/height; with 'auto' and no
 * measurable image the app uses the 16:9 entry and keeps 'auto' on the wire.
 */
const SIZE_MAP: Record<Resolution, Record<ConcreteRatio, [number, number]>> = {
  '480p': { '21:9': [896, 384], '16:9': [854, 480], '4:3': [640, 480], '1:1': [480, 480], '3:4': [480, 640], '9:16': [480, 854] },
  '720p': { '21:9': [1344, 576], '16:9': [1280, 720], '4:3': [960, 720], '1:1': [720, 720], '3:4': [720, 960], '9:16': [720, 1280] },
  '1080p': { '21:9': [2016, 864], '16:9': [1920, 1080], '4:3': [1440, 1080], '1:1': [1080, 1080], '3:4': [1080, 1440], '9:16': [1080, 1920] },
}

const COST_PER_SECOND: Record<'std' | 'fast', Partial<Record<Resolution, number>>> = {
  std: { '480p': 3, '720p': 4.5, '1080p': 9 },
  fast: { '720p': 3.5 },
}

// Rules grounded in fnf-web's submit validation (job-video-seedance2-0/model/built.ts)
// + the gen-panel submit strategy (gen-panel-model-video-seedance-2-0/submit-strategy.ts)
// + the gen-panel aspect-ratio lock (gen-panel-model-video-seedance-2-0/fields.ts).
// Wire surface: POST /jobs/v2/seedance_2_0 with model/width/height/generate_audio.
// NOTE: the backend rejects input media whose IP check hasn't finished — upload
// inputs with `forceIpCheck: true` (the check then runs synchronously on confirm).
// NOTE: the app also counts reference elements embedded in the prompt text toward
// the 9-image budget; the SDK has no reference-elements concept, so prompts
// carrying that syntax share the cap server-side only.
export const seedance2_0 = defineJob({
  jobSetType: 'seedance_2_0',
  outputType: 'video',
  params: {
    prompt: true,
    media: {
      field: 'medias',
      format: 'wrapped',
      roles: ['image', 'start_image', 'end_image', 'video', 'audio'],
      counts: { start_image: { max: 1 }, end_image: { max: 1 }, video: { max: 3 }, audio: { max: 3 } },
      rules: [
        // audio-only is not supported — it needs a visual to score
        requiresOneOf('audio', ['image', 'video', 'start_image', 'end_image']),
        // reference images (incl. frames) are capped at 9 in total
        maxTotal(['image', 'start_image', 'end_image'], 9),
        // Intrinsic-size/duration constraints from fnf-web's built.ts
        // (getMediaConstraintError + the per-media duration loops). They judge
        // MediaRef.meta when present — populate it from app data or via
        // resolveMediaMeta; refs without meta are left to the backend.
        dimensionsWithin(['image', 'start_image', 'end_image'], { minSide: 300, maxSide: 6000, ratio: [0.4, 2.5] }),
        dimensionsWithin(['video'], { minSide: 300, maxSide: 6000, minPixels: 409_600, ratio: [0.4, 2.5] }),
        durationsWithin(['video'], { each: [2, 15] }),
        durationsWithin(['audio'], { each: [2, 15] }),
        // videos + audios share one 15-second budget
        durationsWithin(['video', 'audio'], { total: 15 }),
      ],
    },
    settings: {
      // Per-model job param (seedance-2-0 honors batch_size in fnf-web). Orthogonal
      // to the client-side `count` fan-out: total outputs = count × batchSize.
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
      // Continuous 4–15s (the product slider), not a discrete set. Enforced in
      // validate (built.ts hard-rejects out-of-range), not just adjust()-snapped.
      duration: z.duration({ min: 4, max: 15 }),
      aspectRatio: z.wire('aspect_ratio', z.aspectRatio(Object.values(Seedance2AspectRatio))),
      // Per-mode product default applied in finalize: std → 1080p, fast → 720p
      // (gen-panel fields.ts; fast never offers 1080p).
      resolution: z.optional(z.enum(['480p', '720p', '1080p'])),
      // Public knob; maps to the wire `model` (seedance_2_0 / seedance_2_0_fast).
      mode: z._default(z.enum(['std', 'fast']), 'std'),
      generateAudio: z.wire('generate_audio', z._default(z.boolean(), true)),
      bitrateMode: z.wire('bitrate_mode', z._default(z.enum(['standard', 'high']), 'standard')),
    },
  },
  credits: ({ settings }) => {
    const mode = settings.mode ?? 'std'
    const resolution = settings.resolution ?? (mode === 'fast' ? '720p' : '1080p')
    const perSecond = COST_PER_SECOND[mode][resolution]
    if (perSecond === undefined)
      return null
    return Math.ceil((settings.duration ?? 4) * perSecond) * (settings.batchSize ?? 1)
  },
  validate: ({ prompt, media, settings }) => {
    const issues = []
    const text = (prompt?.instruction ?? '').trim()
    const visuals = countRefs(media, 'image') + countRefs(media, 'start_image')
      + countRefs(media, 'end_image') + countRefs(media, 'video')

    if (text.length > MAX_PROMPT_CHARACTERS)
      issues.push({ loc: ['prompt'], msg: `Prompt is too long (max ${MAX_PROMPT_CHARACTERS} characters)` })
    if (!text && visuals === 0)
      issues.push({ loc: ['prompt'], msg: 'Prompt is required when no media is provided' })
    // The gen-panel locks the ratio to 'auto' once frames are attached; a forced
    // concrete ratio with a frame fails the generation on the backend.
    if (FRAME_ROLES.some(role => countRefs(media, role) > 0) && settings.aspectRatio !== 'auto')
      issues.push({ loc: ['settings', 'aspectRatio'], msg: 'aspectRatio must be \'auto\' when a start/end frame is attached' })
    issues.push(...oneOf('aspectRatio', settings.aspectRatio, Object.values(Seedance2AspectRatio)))
    // built.ts: !duration || duration < 4 || duration > 15 is a hard reject.
    issues.push(...intRange('duration', settings.duration, 4, 15))
    issues.push(...intRange('batchSize', settings.batchSize, 1, 4))
    // The product's fast config offers 480p/720p only — fast@1080p has no cost
    // table entry and is unreachable from the app.
    if (settings.mode === 'fast' && settings.resolution === '1080p')
      issues.push({ loc: ['settings', 'resolution'], msg: 'resolution \'1080p\' is not available in fast mode' })
    return issues
  },
  finalize: (wire, input) => {
    const mode = wire.mode
    const resolution = (wire.resolution ?? (mode === 'fast' ? '720p' : '1080p')) as Resolution
    // 'auto' resolves like the product: measure the FIRST attached image-like
    // ref and snap to the closest concrete ratio (submit-strategy.ts). Without
    // meta, a round-tripped generation's stored width/height (riding in extra)
    // stand in for the measurement — restore mapped 'auto' back for the frame
    // lock, and the stored dims encode exactly what the frame resolved to.
    // Only a fresh 'auto' submit with no size knowledge at all keeps 'auto'
    // on the wire with the 16:9 dims (the product's no-image branch).
    let ratio = wire.aspect_ratio as string
    if (ratio === 'auto') {
      const size = firstSizeMeta(input.media, IMAGE_ROLES)
        ?? (typeof wire.width === 'number' && typeof wire.height === 'number' && wire.height > 0
          ? { width: wire.width, height: wire.height }
          : undefined)
      if (size)
        ratio = closestRatioBySize(CONCRETE_RATIOS, size)
    }
    // Dims always come fresh from the table — a parsed input whose resolution
    // or media changed re-derives instead of resubmitting stale extra dims.
    const { width, height } = lookupSize(SIZE_MAP, resolution, ratio === 'auto' ? '16:9' : ratio)
    return {
      ...wire,
      // `model` is the operative backend field (cost/plan/queue all key off
      // it); `mode` also stays on the wire — the backend schema declares it
      // and echoes it in stored params, so product UIs read the right label.
      model: mode === 'fast' ? 'seedance_2_0_fast' : 'seedance_2_0',
      prompt: wire.prompt ?? '', // required string on the wire; '' is valid with media
      aspect_ratio: ratio,
      resolution,
      width,
      height,
    }
  },
  restore: (wire) => {
    // Pre-mode-on-wire params only carry `model` — bring `mode` back so a
    // fetched fast generation resubmits as fast, not the 'std' schema default.
    const restored: Record<string, unknown> = {
      mode: wire.model === 'seedance_2_0_fast' ? 'fast' : 'std',
    }
    // With a frame attached the input ratio is necessarily 'auto' (validate
    // locks it); the concrete wire ratio came from the frame's measured size.
    // Map it back so the parsed input passes the same validate on resubmit.
    const medias = Array.isArray(wire.medias) ? wire.medias as Array<{ role?: string }> : []
    if (medias.some(m => m?.role === 'start_image' || m?.role === 'end_image'))
      restored.aspect_ratio = 'auto'
    return restored
  },
})
