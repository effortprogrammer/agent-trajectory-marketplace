import { defineJob } from '../define-job'
import { z } from '../z'
import { countRefs, oneOf } from './checks'
import { aspectRatioDimensions, firstSizeMeta, simplifyRatio } from './dimensions'

/** Kling model versions as a named, refactorable object enum (erased at runtime). */
export const KlingModel = {
  v2_1: 'kling-v2-1',
  v2_1Master: 'kling-v2-1-master',
  v2_5Turbo: 'kling-v2-5-turbo',
} as const

/**
 * The product's "no motion preset" sentinel (fnf-web defaultKlingPresetId):
 * the form always puts a motion_id on the wire, and THIS id means "none" —
 * KlingVideoJob.submit forces enhance_prompt only for ids different from it.
 */
export const KLING_DEFAULT_MOTION_ID = '7077cde8-7947-46d6-aea2-dbf2ff9d441c'

const MAX_PROMPT_CHARACTERS = 2000 // fnf-web submit/kling.ts: throws at >= 2000

// The only aspect_ratio values the backend accepts (fnf-api types_/kling.py).
const KLING_WIRE_RATIOS = new Set(['16:9', '9:16', '1:1'])

/**
 * Kling video — the /ai/video product model. Grounded in fnf-web's
 * VideoKlingSubmitParams + KlingVideoJob.submit (entities/job/model/submit/
 * kling.ts) and mapKlingParams: prompt is OPTIONAL (< 2000 chars when present —
 * motion presets run promptless), `mode` is NOT an input (derived from
 * model/resolution), enhance_prompt is forced on for any real motion preset
 * (motion_id !== the default sentinel). I2V via `input_image`; left optional
 * because the surfaces disagree — the /ai/video form hard-requires a start
 * frame ('Start frame required') but the app-viewer host advertises text-only
 * kling and the wire contract admits input_image: null. `input_image_end` is
 * not a declared role yet — but when a caller passes it via `extra`, finalize
 * still applies the product's enhance rule (an end frame forces it off).
 * NOTE: `parentId` is NOT honored by POST /jobs/kling — the backend's
 * CreateKlingJobSchema has no parent_id field, so it is silently dropped.
 */
export const klingVideo = defineJob({
  jobSetType: 'kling',
  outputType: 'video',
  params: {
    prompt: true,
    /** First frame to animate (I2V), as an uploaded `/media` input image. */
    media: { field: 'input_image', format: 'single', roles: ['input_image'] },
    settings: {
      model: z._default(z.enum(Object.values(KlingModel)), KlingModel.v2_5Turbo),
      // NOTE: the product also wires seed and cfg_scale, but the backend's
      // KlingParamsSchema declares neither (fnf-api schemas/job/kling.py) and
      // pydantic silently drops them — kling runs are not seeded or
      // CFG-tunable, so the SDK doesn't advertise the knobs.
      resolution: z._default(z.enum(['720p', '1080p']), '720p'),
      cameraControl: z.wire('camera_control', z._default(z.nullable(z.string()), null)),
      // The wire always carries a motion_id; the sentinel means "no preset"
      // (mapKlingParams: preset_id ?? defaultKlingPresetId).
      motionId: z.wire('motion_id', z._default(z.nullable(z.string()), KLING_DEFAULT_MOTION_ID)),
      duration: z.duration({ values: [5, 10] }),
      /** Fallback for width/height when the start image's size is unknown locally. */
      aspectRatio: z.wire('aspect_ratio', z._default(z.string(), '16:9')),
    },
  },
  validate: ({ prompt, media, settings }) => {
    // RAW length, like the product (KlingVideoJob.submit checks the untrimmed
    // string — the same form the codec puts on the wire).
    const raw = prompt?.instruction ?? ''
    const issues = raw.length >= MAX_PROMPT_CHARACTERS
      ? [{ loc: ['prompt'], msg: `Prompt is too long (max ${MAX_PROMPT_CHARACTERS} characters)` }]
      : []
    issues.push(...oneOf('duration', settings.duration, [5, 10]))
    // The backend's check_input_image (fnf-api schemas/job/kling.py): a start
    // frame is required for every model/mode EXCEPT v2-5-turbo at 1080p (pro) —
    // the only text-only combination that exists server-side. Fail locally with
    // the backend's own wording instead of a 422.
    const textOnlyAllowed = settings.model === KlingModel.v2_5Turbo && settings.resolution === '1080p'
    if (countRefs(media, 'input_image') === 0 && !textOnlyAllowed)
      issues.push({ loc: ['media', 'input_image'], msg: 'input image is required for this model and mode' })
    return issues
  },
  finalize: (wire, input) => {
    const model = wire.model as string
    const resolution = wire.resolution as string
    // The product never wires a null motion_id — mapKlingParams coalesces to
    // the sentinel BEFORE the enhance check. Legacy SDK params (and explicit
    // null callers) coalesce the same way, so a stored enhance_prompt: false
    // is respected on resubmit instead of being force-flipped.
    const motionId = wire.motion_id ?? KLING_DEFAULT_MOTION_ID
    // Wire width/height are the start image's intrinsic size in the product
    // (mapKlingParams measures it). Precedence: the ref's MediaRef.meta
    // (resolveMediaMeta — wins so a swapped image re-measures) → an existing
    // wire value (a round-tripped generation's params, via extra) → the
    // aspect-ratio box as a last resort.
    const measured = firstSizeMeta(input.media, ['input_image'])
    const box = aspectRatioDimensions(wire.aspect_ratio as string | undefined, 720)
    const width = measured?.width ?? (typeof wire.width === 'number' ? wire.width : box.width)
    const height = measured?.height ?? (typeof wire.height === 'number' ? wire.height : box.height)
    // aspect_ratio IS an optional backend param, but only as the enum
    // 16:9 | 9:16 | 1:1 (fnf-api types_/kling.py) — pass it through when it
    // fits, drop anything else (the wire's real geometry is width/height).
    const { aspect_ratio, ...rest } = wire
    const wireRatio = KLING_WIRE_RATIOS.has(aspect_ratio as string) ? { aspect_ratio } : {}
    return {
      ...rest,
      ...wireRatio,
      prompt: wire.prompt ?? '', // the product always sends a string ('' when promptless)
      motion_id: motionId,
      width,
      height,
      // Derivations from prod KlingVideoJob.submit:
      mode: model !== KlingModel.v2_1Master ? (resolution === '1080p' ? 'pro' : 'std') : 'std',
      // The product's exact precedence (KlingVideoJob.submit): a real preset
      // forces it on; an end frame (reaching the wire via extra — the role is
      // not declared yet) forces it off; otherwise the caller's choice,
      // defaulting to true like the product form (enhance ?? true).
      enhance_prompt: motionId !== KLING_DEFAULT_MOTION_ID
        ? true
        : wire.input_image_end ? false : wire.enhance_prompt ?? true,
    }
  },
  restore: (wire) => {
    // finalize keeps aspect_ratio only for the backend's 16:9|9:16|1:1 enum —
    // when the stored params carry none, derive it from width/height so the
    // parsed input reads naturally; the round-tripped width/height in extra
    // still win in finalize, so resubmits keep the exact original dims.
    if (wire.aspect_ratio == null && typeof wire.width === 'number' && typeof wire.height === 'number' && wire.height > 0)
      return { aspect_ratio: simplifyRatio(wire.width, wire.height) }
    return {}
  },
})
