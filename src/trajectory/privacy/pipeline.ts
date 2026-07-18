import type { HarnessTraceDocument } from "../adapters/contract"
import { applyPrivacyPass } from "./apply"
import { createCachedPrivacyFilter, openPrivacyCache, type PrivacyCache } from "./cache"
import {
  type PiiCategory,
  type PrivacyFilter,
  type PrivacyPassConfig,
  privacyConfigHash,
  resolvePrivacyPassConfig,
} from "./contract"
import {
  createEnginePrivacyFilter,
  defaultPrivacyEngineUrl,
  privacyEngineUrlEnv,
  probePrivacyEngine,
} from "./engine-client"
import { createTransformersPrivacyFilter } from "./transformers-runner"

// Auto mode (env unset): prefer the resident local MLX engine whenever its
// health probe answers, else run the in-process CPU runner. The probe runs
// once per detect() call — one local GET per trace — so the choice tracks
// the engine's actual liveness instead of a stale startup snapshot.
export const createAutoPrivacyFilter = (
  engineUrl: string,
  makeLocalFilter: () => PrivacyFilter,
): PrivacyFilter => {
  const engine = createEnginePrivacyFilter(engineUrl)
  let local: PrivacyFilter | undefined
  return {
    detect: async (texts) => {
      if (await probePrivacyEngine(engineUrl)) {
        return engine.detect(texts)
      }
      local ??= makeLocalFilter()
      return local.detect(texts)
    },
  }
}

// Backend order: an explicitly injected filter (tests) wins; an explicit
// TRAJECTORY_PRIVACY_ENGINE_URL pins the engine fail-closed (value "off"
// pins the CPU runner); otherwise auto-detect the resident local engine
// with CPU fallback, so a machine with the launchd engine installed uses it
// by default and one without it still collects.
const defaultPrivacyFilter = (modelId: string): PrivacyFilter => {
  const engineUrl = process.env[privacyEngineUrlEnv]?.trim()
  if (engineUrl === "off") {
    return createTransformersPrivacyFilter(modelId)
  }
  if (engineUrl !== undefined && engineUrl.length > 0) {
    return createEnginePrivacyFilter(engineUrl)
  }
  return createAutoPrivacyFilter(defaultPrivacyEngineUrl, () =>
    createTransformersPrivacyFilter(modelId),
  )
}

// Collect-facing privacy wiring: the CLI and the sweep pass loose options in,
// this resolves them once into either a disabled marker or a ready-to-run
// (config, filter, hash) triple. The default filter is the Transformers.js
// runner; tests inject fixed-span fakes instead.

export type CollectPrivacyOptions = Readonly<{
  // Default true. false is the --no-privacy-filter escape hatch: the trace
  // exports without a stamp and is therefore not marketplace-ready.
  enabled?: boolean
  threshold?: number
  modelId?: string
  maskCategories?: readonly PiiCategory[]
  filter?: PrivacyFilter
  cache?: Readonly<{
    enabled: boolean
    path: string
    // Test-injection seam mirroring how `filter` is injectable: when provided,
    // the pipeline uses this handle verbatim instead of calling
    // openPrivacyCache(path). Production callers omit it; the CLI always does.
    handle?: PrivacyCache
  }>
}>

export type ResolvedCollectPrivacy =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true
      config: PrivacyPassConfig
      configHash: string
      filter: PrivacyFilter
      // Present only when the caller asked for the cache AND privacy is on.
      // Owners are the call sites of resolveCollectPrivacy (runCollectSweep,
      // exportCollectedSession, filterExistingTrace) — they MUST call
      // `cache?.close()` in a `finally` block around the work that uses the
      // resolved privacy. Per Oracle O1, the resolved type exposes the handle
      // so callers can close it without re-deriving it from the options.
      cache?: PrivacyCache
    }>

export const resolveCollectPrivacy = async (
  options: CollectPrivacyOptions = {},
): Promise<ResolvedCollectPrivacy> => {
  // Privacy disabled short-circuits BEFORE any cache is opened — the spec
  // requires the cache file never be touched when the privacy filter is off
  // (acceptance 6).
  if (options.enabled === false) {
    return { enabled: false }
  }
  const config = resolvePrivacyPassConfig({
    ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    ...(options.maskCategories === undefined
      ? {}
      : { maskCategories: [...options.maskCategories] }),
  })
  const configHash = privacyConfigHash(config)
  const innerFilter = options.filter ?? defaultPrivacyFilter(config.modelId)
  const cacheOptions = options.cache
  // Gate: cache must be explicitly enabled AND privacy is on (privacy off
  // returns above). When enabled, open (or reuse the injected handle) and
  // wrap the inner filter so every detect() round-trips through the cache.
  if (cacheOptions?.enabled === true) {
    const cache = cacheOptions.handle ?? (await openPrivacyCache(cacheOptions.path))
    return {
      enabled: true,
      config,
      configHash,
      filter: createCachedPrivacyFilter(innerFilter, cache, configHash),
      cache,
    }
  }
  return {
    enabled: true,
    config,
    configHash,
    filter: innerFilter,
  }
}

// Surfaced in export results so callers see what the pass did (or that it was
// skipped and the trace cannot be listed).
export type CollectPrivacySummary = Readonly<{
  filtered: boolean
  maskedSpanCount?: number
  configHash?: string
  warning?: string
}>

const unfilteredPrivacyWarning =
  "privacy filter disabled: unfiltered collected traces are not marketplace-ready"

// The one collect-side application of the pass: both the one-shot export and
// the resident sweep run through this, so disabled-mode semantics, the stamp
// clock, and the summary shape cannot drift between them.
export const applyCollectPrivacy = async (
  trace: HarnessTraceDocument,
  privacy: ResolvedCollectPrivacy,
  now?: Date,
): Promise<{ trace: HarnessTraceDocument; summary: CollectPrivacySummary }> => {
  if (!privacy.enabled) {
    return { trace, summary: { filtered: false, warning: unfilteredPrivacyWarning } }
  }
  const passed = await applyPrivacyPass(trace, privacy.filter, privacy.config, now)
  return {
    trace: passed.trace,
    summary: {
      filtered: true,
      maskedSpanCount: passed.maskedSpanCount,
      configHash: privacy.configHash,
    },
  }
}
