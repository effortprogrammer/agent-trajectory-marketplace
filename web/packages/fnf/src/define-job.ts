import type * as zm from 'zod/mini'
import type { MediaConfig, MediaIssue, MediaRule } from './groups/media'
import type { GenerationInput, MediaFormat, MediaRef, OutputType, PromptInput } from './types'
import type { Normalize, NORMALIZE_TYPE } from './z'
import { promptCodec } from './groups/prompt'
import { getNormalize, getWireName, z } from './z'

type SettingsMap = Record<string, unknown>

/**
 * The input type of one settings field. Normalized fields (`z.aspectRatio` /
 * `z.duration`) carry a phantom literal union under `NORMALIZE_TYPE` — prefer it
 * so callers get autocomplete on the canonical values; otherwise fall back to
 * the schema's zod input type.
 */
type FieldInput<T> = T extends { readonly [NORMALIZE_TYPE]: infer U } ? U : zm.input<T>

/**
 * The settings shape a caller passes for a job: each field typed from
 * `FieldInput`, and made optional when that input admits `undefined`
 * (i.e. `z.optional(...)` / `z._default(...)`).
 */
export type SettingsInput<M extends SettingsMap> = [keyof M] extends [never]
  ? Record<string, never> // a zero-settings job takes {}, not "anything" (bare {} accepts 42)
  : & { [K in keyof M as undefined extends FieldInput<M[K]> ? never : K]: FieldInput<M[K]> }
    & { [K in keyof M as undefined extends FieldInput<M[K]> ? K : never]?: FieldInput<M[K]> }

/**
 * A job's media declaration, with its allowed roles captured as literals.
 * `roles` is the ONLY inference site for the literal union (`NoInfer` below):
 * `counts` keys and `MediaRule<Roles>` hold `Roles` in partial/contravariant
 * positions, and letting them contribute candidates (subsets from `maxTotal`
 * etc.) makes newer TS reconcile the conflict by widening to `string` —
 * which silently breaks the `media` key narrowing on `submit`.
 */
export interface MediaConfigFor<Roles extends string> {
  field: string
  format: MediaFormat
  roles: readonly Roles[]
  /** Per-role cardinality: `min >= 1` makes the role required; `max` caps it. */
  counts?: Partial<Record<NoInfer<Roles>, { min?: number, max?: number }>>
  /** Cross-role rules (`requiresOneOf`/`atLeastOneOf`, or any custom `MediaRule`). */
  rules?: readonly MediaRule<NoInfer<Roles>>[]
}

/**
 * The non-settings input fields a job exposes, derived entirely from what the
 * job declares — no universal assumptions. A job that declares no `media` gets
 * no `media` field in its input type; one that declares no `prompt` gets none.
 * When `media` is declared its key is narrowed to the job's roles.
 */
type MediaField<Roles extends string> = [Roles] extends [never]
  ? { media?: never } // `never`, not `unknown`: rejects non-fresh objects too, not just literals
  : { media?: Partial<Record<Roles, MediaRef | MediaRef[]>> }
type PromptField<P extends boolean> = P extends true ? { prompt?: PromptInput } : { prompt?: never }
export type Envelope<Roles extends string, P extends boolean> = MediaField<Roles> & PromptField<P>

/**
 * A job's params declaration — it mirrors the backend wire `params` object:
 * the `prompt`/`media` envelopes (serialized by their codecs) plus the scalar
 * `settings` fields (zod schemas; tag a wire name with `z.wire`).
 */
export interface JobParams<M extends SettingsMap, Roles extends string, P extends boolean> {
  /** Set `true` to expose the standard prompt group. Omit for a job that takes no prompt. */
  prompt?: P
  /** Declare media support — its `roles` become the allowed `media` keys. Omit for a job that takes no media. */
  media?: MediaConfigFor<Roles>
  /** The scalar wire fields. */
  settings: M
}

export interface DefineJobConfig<Type extends string, M extends SettingsMap, Roles extends string, P extends boolean> {
  jobSetType: Type
  outputType: OutputType
  params: JobParams<M, Roles, P>
  /**
   * Optional local per-job credit calculator (the fnf-web `credits(ctx)` pattern):
   * lets `cost()` answer without a network round-trip. `input.settings` is typed
   * to THIS model's schema; `estimateCost` parses settings first, so schema
   * defaults are already applied when the calculator runs. Return null when the
   * inputs aren't sufficient to price locally — `estimateCost` then falls back
   * to the backend. Price ONE job (the `count` fan-out multiplies upstream).
   */
  credits?: (input: GenerationInput<SettingsInput<M>>) => number | null
  /**
   * Cross-field validation across the WHOLE input (prompt × media × settings) —
   * the rules `counts`/`rules` can't express (e.g. "prompt is required unless
   * media is attached"). Runs in the submit path after parse + media checks;
   * return pydantic-shaped issues, or null/[] when valid. Sync and pure.
   */
  validate?: (input: GenerationInput<SettingsInput<M>>) => MediaIssue[] | null
  /**
   * The job-level body hooks — ONE serialization lifecycle, documented once:
   *
   *   submit: input → codecs + settings assemble the wire body → `finalize(wire, input)` → POST
   *   get:    stored params → `restore(params)` overlay → codecs + settings parse → input
   *
   * `finalize` is the job's last touch on the assembled body: derive fields
   * (seedance folds `mode` into the wire `model`), compute width/height, inject
   * the constants the product surface always sends (soul's `version: 3`).
   * Omit it when the declared fields map 1:1.
   */
  finalize?: (wire: Record<string, unknown>, input: GenerationInput) => Record<string, unknown>
  /**
   * Inverse of `finalize`, required whenever finalize DELETES or renames a
   * settings key: without it `parseGeneration` can't see the original setting
   * and get-then-resubmit silently falls back to the schema default — a fetched
   * fast generation would resubmit as std. Return the wire-keyed entries to
   * overlay on the stored params before settings extraction. Omit otherwise.
   */
  restore?: (wire: Record<string, unknown>) => Record<string, unknown>
}

export interface JobEntry<Type extends string = string, Settings = Record<string, unknown>, Env = unknown> {
  jobSetType: Type
  outputType: OutputType
  /** Present only when the job declared media. */
  media?: MediaConfig
  /** Whether the standard prompt group is active for this job. */
  prompt: boolean
  settingsMap: SettingsMap
  settingsSchema: ReturnType<typeof z.object>
  normalizers: Record<string, Normalize>
  /** Explicit wire-name overrides for settings (local key → wire key), from `z.wire`. */
  wireNames: Record<string, string>
  /** Local per-job credit calculator; null = can't price locally (backend fallback). */
  credits?: (input: GenerationInput) => number | null
  /** Cross-field validation (prompt × media × settings); pydantic-shaped issues. */
  validate?: (input: GenerationInput) => MediaIssue[] | null
  /** Last touch on the assembled wire body — see DefineJobConfig.finalize. */
  finalize?: (wire: Record<string, unknown>, input: GenerationInput) => Record<string, unknown>
  /** Inverse of `finalize` (wire-keyed overlay) — see DefineJobConfig.restore. */
  restore?: (wire: Record<string, unknown>) => Record<string, unknown>
  /** Phantom: the typed settings-input shape. Carries types only, never set at runtime. */
  readonly __settings?: Settings
  /** Phantom: the typed envelope (media/prompt) the job exposes. Types only. */
  readonly __envelope?: Env
}

export function defineJob<
  const Type extends string,
  M extends SettingsMap,
  const Roles extends string = never,
  const P extends boolean = false,
>(
  config: DefineJobConfig<Type, M, Roles, P>,
): JobEntry<Type, SettingsInput<M>, Envelope<Roles, P>> {
  const { prompt, media, settings } = config.params
  // Non-`wrapped` media formats carry no role tag on the wire, so they can only
  // represent one role — guard the invariant the types alone can't (callers may
  // bypass with `as`). See mediaCodec serialize/parse.
  if (media && media.format !== 'wrapped' && media.roles.length !== 1) {
    throw new Error(
      `defineJob('${config.jobSetType}'): media format '${media.format}' supports exactly one role, got ${media.roles.length} [${media.roles.join(', ')}] — use format 'wrapped' for multi-role media`,
    )
  }
  const wireNames = collectWireNames(settings)
  assertNoWireCollisions(config.jobSetType, settings, wireNames, prompt ?? false, media)

  return {
    jobSetType: config.jobSetType,
    outputType: config.outputType,
    media,
    prompt: prompt ?? false,
    settingsMap: settings,
    settingsSchema: z.object(settings as Record<string, never>),
    normalizers: collectNormalizers(settings),
    wireNames,
    // Type-erased on the entry (the registry is heterogeneous); the runtime
    // value IS the caller's typed input — same erasure as settingsSchema.
    credits: config.credits as JobEntry['credits'],
    validate: config.validate as JobEntry['validate'],
    finalize: config.finalize,
    restore: config.restore,
  }
}

/**
 * Duplicate effective wire keys (two settings → one key via z.wire / a shared
 * tagged schema instance, or a settings key shadowing a prompt/media wire key)
 * would serialize last-write-wins and parse back ambiguously — fail at
 * definition time instead.
 */
function assertNoWireCollisions(jobSetType: string, settings: SettingsMap, wireNames: Record<string, string>, prompt: boolean, media?: MediaConfig): void {
  const reserved = new Set<string>([...(prompt ? promptCodec.wireKeys : []), ...(media ? [media.field] : [])])
  const seen = new Map<string, string>()
  for (const key of Object.keys(settings)) {
    const wireKey = wireNames[key] ?? key
    const clash = seen.get(wireKey)
    if (clash !== undefined)
      throw new Error(`defineJob('${jobSetType}'): settings '${clash}' and '${key}' both serialize to wire key '${wireKey}'`)
    if (reserved.has(wireKey))
      throw new Error(`defineJob('${jobSetType}'): settings key '${key}' collides with the ${prompt && promptCodec.wireKeys.includes(wireKey) ? 'prompt' : 'media'} wire key '${wireKey}'`)
    seen.set(wireKey, key)
  }
}

function collectNormalizers(settings: SettingsMap): Record<string, Normalize> {
  const out: Record<string, Normalize> = {}
  for (const [key, schema] of Object.entries(settings)) {
    const n = getNormalize(schema)
    if (n)
      out[key] = n
  }
  return out
}

function collectWireNames(settings: SettingsMap): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, schema] of Object.entries(settings)) {
    const name = getWireName(schema)
    if (name !== undefined && name !== key)
      out[key] = name
  }
  return out
}
