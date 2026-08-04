/**
 * The generation catalog — model declarations and the toolkit to author them.
 * This entry is intentionally separate from `@higgsfield/fnf/client`: a bundle
 * that only declares/ships models never pulls the client (and vice versa).
 */
export { defineJob } from '../define-job'
export type { DefineJobConfig, Envelope, JobEntry, JobParams, MediaConfigFor, SettingsInput } from '../define-job'
// Cross-role rule combinators for media declarations: cardinality
// (requiresOneOf/atLeastOneOf/maxTotal) and meta (dimensionsWithin/durationsWithin).
export { atLeastOneOf, checkMedia, dimensionsWithin, durationsWithin, maxTotal, requiresOneOf } from '../groups/media'
export type { DimensionLimits, MediaIssue, MediaRule } from '../groups/media'

// The settings-schema toolkit model authors need (z.wire / z.aspectRatio / z.duration).
export { aspectRatio, duration, getNormalize, getWireName, wire, z } from '../z'
export type { Normalize } from '../z'

// Validate-hook issue builders (uniform pydantic-shaped issues across models).
export { countRefs, intRange, oneOf, promptMax, promptRequired, randomSeed } from './checks'
export { aspectRatioDimensions, closestRatioBySize, firstSizeMeta, lookupSize, simplifyRatio } from './dimensions'
export type { AspectRatioDimensions } from './dimensions'
export { gptImage2, GptImage2AspectRatio } from './gpt-image-2'
export { grokImagine, GrokImagineAspectRatio, GrokImagineResolution, grokImagineV15 } from './grok-imagine'
export { happyHorse, HappyHorseAspectRatio, HappyHorseResolution } from './happy-horse'
export { mediaRefSchema, toWireMediaData } from './image-helpers'
export { KLING_DEFAULT_MOTION_ID, KlingModel, klingVideo } from './kling'
export { kling3_0, Kling3AspectRatio, Kling3Mode, Kling3Sound } from './kling-3'
export { kling3MotionControl, Kling3MotionControlMode, Kling3MotionControlOrientation } from './kling-3-motion-control'
export { nanoBanana2, NanoBanana2AspectRatio } from './nano-banana-2'
export { nanoBanana2Upscale, NanoBanana2UpscaleAspectRatio } from './nano-banana-2-upscale'
export { nanoBananaFlash, NanoBananaFlashAspectRatio } from './nano-banana-flash'
export { RecraftV41AspectRatio, recraftV41Image, RecraftV41Model, RecraftV41ModelType } from './recraft-v4-1'
export { seedance2_0, Seedance2AspectRatio } from './seedance-2-0'
export { seedreamV4_5, SeedreamV4_5AspectRatio } from './seedream-v4-5'
export { DEFAULT_SOUL_CINEMA_OLZHAS_STYLE_ID, DEFAULT_SOUL_CINEMA_STYLE_ID, DEFAULT_SOUL_V2_STYLE_ID, soulCinemaImage, SoulV2AspectRatio, soulV2Image } from './soul-v2'
export { DEFAULT_SOUL_STYLE_ID, textToImageSoul } from './text2image-soul'
export { topazImageGenerativeUpscale, TopazImageModel, topazImageUpscale, TopazImageUpscaleFactor } from './topaz-image-upscale'
export { veo3_1Lite, Veo31LiteAspectRatio, Veo31LiteResolution } from './veo-3-1-lite'
export { batch, extractAngleRefIds, firstMetaDuration, firstMetaSize, integerRange, refsFor, requiredPromptOrRole } from './video-helpers'
export type { Size } from './video-helpers'
export { bytedanceVideoUpscale, BytedanceVideoUpscalePreset, BytedanceVideoUpscaleResolution, higgsfieldVideoUpscale, soraEnhanceVideo, TopazVideoEnhancementModel, TopazVideoFocusFix, TopazVideoModel, TopazVideoParameters, TopazVideoResolution, topazVideoUpscale } from './video-upscale'
export { wan27, Wan27AspectRatio, Wan27Quality } from './wan-2-7'
