import { defineJob } from '../define-job'
import { z } from '../z'
import { intRange, randomSeed } from './checks'
import { closestRatioBySize } from './dimensions'

/**
 * The product's default Soul style (fnf-web defaultSoulStyleId, soul-values.tsx).
 * The app NEVER submits style_id null on this surface — it falls back to this id
 * even in image-reference mode (null style_id exists only in fashion-factory
 * flows, where fashion_factory_id is sent instead — via `extra` in the SDK).
 */
export const DEFAULT_SOUL_STYLE_ID = '464ea177-8d40-4940-8d9d-b438bab269c7'

type Quality = '720p' | '1080p'

/**
 * fnf-web SOUL_RESOLUTION_MAP (entities/job/image/config/soul-values.tsx):
 * quality × ratio → [width, height], all 32/64-aligned. Unknown ratios fall
 * back exactly like the product's getSoulResolutionFromAspectRatio.
 */
const SIZE_MAP: Record<Quality, Record<string, readonly [number, number]>> = {
  '1080p': { '9:16': [1152, 2048], '16:9': [2048, 1152], '4:3': [2048, 1536], '3:4': [1536, 2048], '1:1': [2048, 2048], '2:3': [1344, 2016], '3:2': [2016, 1344], '21:9': [2528, 1088] },
  '720p': { '9:16': [960, 1696], '1:1': [1536, 1536], '4:3': [1536, 1152], '16:9': [1696, 960], '3:4': [1152, 1536], '2:3': [1088, 1632], '3:2': [1632, 1088], '21:9': [1680, 720] },
}
const FALLBACK_SIZE: Record<Quality, readonly [number, number]> = {
  '1080p': [768, 1024],
  '720p': [1152, 1536],
}

/**
 * Soul text-to-image — the /ai/image product model. Grounded in fnf-web's
 * soul submit strategy (gen-panel-model-image-soul/submit-strategy.ts) and
 * getDefaultSoulExpandedForm: steps 50, sample_guide_scale 4, sample_shift
 * 3 (720p) / 4 (1080p), negative_prompt '' (via `prompt.negative`), and
 * width/height looked up in SOUL_RESOLUTION_MAP from quality × aspect ratio.
 * enhance_prompt mirrors resolveEnhancePrompt's production behavior: false
 * with an image reference, forced true for a non-default style, otherwise the
 * caller's choice (default true).
 */
export const textToImageSoul = defineJob({
  jobSetType: 'text2image_soul',
  outputType: 'image',
  params: {
    prompt: true,
    /** An uploaded `/media` input image to edit/transform. */
    media: { field: 'image_reference', format: 'single', roles: ['image_reference'] },
    settings: {
      /** The Soul style; the product always sends one (default style when unset). */
      styleId: z.wire('style_id', z._default(z.nullable(z.string()), DEFAULT_SOUL_STYLE_ID)),
      customReferenceId: z.wire('custom_reference_id', z.optional(z.nullable(z.string()))),
      customReferenceStrength: z.wire('custom_reference_strength', z.optional(z.nullable(z.number()))),
      steps: z._default(z.number(), 50),
      batchSize: z.wire('batch_size', z._default(z.number(), 1)),
      /** Always on the wire (prod sends `seed || randomSeed()`); randomized when omitted. */
      seed: z._default(z.number(), randomSeed),
      quality: z._default(z.enum(['720p', '1080p']), '1080p'),
      // The product soul form defaults to PORTRAIT (createSoulForm: '3:4').
      aspectRatio: z.wire('aspect_ratio', z._default(z.string(), '3:4')),
      /** Diffusion sampler shift; the product derives 3 (720p) / 4 (1080p) when unset. */
      sampleShift: z.wire('sample_shift', z.optional(z.number())),
      sampleGuideScale: z.wire('sample_guide_scale', z._default(z.number(), 4)),
    },
  },
  // Ranges from the SoulSubmitParams contract comments (steps 1–50, batch 1–4,
  // seed 1–1M). No prompt rules: prod's soul submit has none (style-only runs).
  validate: ({ settings }) => {
    const issues = [
      ...intRange('steps', settings.steps, 1, 50),
      ...intRange('batchSize', settings.batchSize, 1, 4),
      ...intRange('seed', settings.seed, 1, 1_000_000),
    ]
    // The backend 422s when style_id AND fashion_factory_id are both absent
    // ("'style_id' or 'fashion_factory_id' must be provided") — reachable only
    // by passing styleId: null explicitly, since the default is the product's
    // default style (a fashion-factory flow would ride fashion_factory_id via
    // `extra`).
    if (settings.styleId == null)
      issues.push({ loc: ['settings', 'styleId'], msg: 'styleId is required (or send fashion_factory_id via extra)' })
    return issues
  },
  finalize: (wire) => {
    const quality = (wire.quality ?? '1080p') as Quality
    const row = SIZE_MAP[quality]
    // The product UI can only emit the 8 table ratios; the SDK's schema is an
    // open string, so snap a parseable off-table ratio ('1920:1080') to the
    // closest table key instead of silently shipping the portrait fallback
    // for a landscape request. Unparseable input keeps the product behavior:
    // raw ratio on the wire + the DEFAULT_RESOLUTIONS fallback dims.
    let ratio = wire.aspect_ratio as string
    if (!row[ratio]) {
      const parsed = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio?.trim() ?? '')
      if (parsed)
        ratio = closestRatioBySize(Object.keys(row), { width: Number(parsed[1]), height: Number(parsed[2]) })
    }
    const [width, height] = row[ratio] ?? FALLBACK_SIZE[quality]
    // resolveEnhancePrompt (production branch): image reference → false;
    // a non-default style forces true; otherwise the caller's choice (true
    // when unset, like the product form's `enhance ?? true`).
    const styleId = wire.style_id ?? DEFAULT_SOUL_STYLE_ID
    const enhance = wire.image_reference != null
      ? false
      : styleId !== DEFAULT_SOUL_STYLE_ID ? true : wire.enhance_prompt ?? true
    return {
      ...wire,
      prompt: wire.prompt ?? '', // SoulSubmitParams types prompt as required ('' for style-only runs)
      aspect_ratio: ratio,
      width,
      height,
      enhance_prompt: enhance,
      sample_shift: wire.sample_shift ?? (quality === '720p' ? 3 : 4),
      // The product sends '' here, which SUPPRESSES the backend's substantive
      // anti-artifact default (fnf-api consts/text2image_soul.py) — kept for
      // byte parity with the product, pending a product decision.
      negative_prompt: wire.negative_prompt ?? '',
    }
  },
})
