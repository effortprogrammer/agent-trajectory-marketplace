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

export const unfilteredPrivacyWarning =
  "privacy filter disabled: unfiltered collected traces are not marketplace-ready"
