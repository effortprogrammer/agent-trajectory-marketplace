import type { HarnessTraceDocument } from "../adapters/contract"
import { applyPrivacyPass } from "./apply"
import {
  type PiiCategory,
  type PrivacyFilter,
  type PrivacyPassConfig,
  privacyConfigHash,
  resolvePrivacyPassConfig,
} from "./contract"
import { createTransformersPrivacyFilter } from "./transformers-runner"

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
}>

export type ResolvedCollectPrivacy =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true
      config: PrivacyPassConfig
      configHash: string
      filter: PrivacyFilter
    }>

export const resolveCollectPrivacy = (
  options: CollectPrivacyOptions = {},
): ResolvedCollectPrivacy => {
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
  return {
    enabled: true,
    config,
    configHash: privacyConfigHash(config),
    filter: options.filter ?? createTransformersPrivacyFilter(config.modelId),
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
