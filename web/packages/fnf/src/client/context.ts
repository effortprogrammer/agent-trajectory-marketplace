import type { GenerationBackend } from '../backend'
import type { JobEntry } from '../define-job'
import type { FnfObservabilityContext, FnfObservabilityOptions } from '../observability'
import type { Registry } from '../registry'
import { ApiJobError } from '../errors'
import { createObservabilityContext } from '../observability'
import { buildRegistry } from '../registry'

export interface ClientConfig<Jobs extends readonly JobEntry[] = readonly JobEntry[]> {
  /** The transport-agnostic jobs adapter. Use one from `@higgsfield/fnf-adapters`, or your own. */
  adapter: GenerationBackend
  /** Registered jobs — the source of `model`/`settings` autocomplete on `submit`. */
  jobs: Jobs
  poll?: { intervalMs?: number, timeoutMs?: number }
  scheduler?: { sleep?: (ms: number) => Promise<void>, isActive?: () => boolean }
  observability?: FnfObservabilityOptions
}

/**
 * The single shared dependency every job operation needs. Build one with
 * `createContext(config)` and pass it to any operation — you do not need the
 * full client to call `submit(ctx, …)` or `listGenerations(ctx, …)`.
 */
export interface GenerationContext {
  adapter: GenerationBackend
  registry: Registry
  poll: { intervalMs: number, timeoutMs: number }
  scheduler: { sleep: (ms: number) => Promise<void>, isActive?: () => boolean }
  observability: FnfObservabilityContext
}

const DEFAULT_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 600_000

/** Resolve user config into the shared context every operation consumes. */
export function createContext(config: ClientConfig<readonly JobEntry[]>): GenerationContext {
  return {
    adapter: config.adapter,
    registry: buildRegistry(config.jobs),
    poll: {
      intervalMs: config.poll?.intervalMs ?? DEFAULT_INTERVAL_MS,
      timeoutMs: config.poll?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    scheduler: {
      sleep: config.scheduler?.sleep ?? defaultSleep,
      isActive: config.scheduler?.isActive,
    },
    observability: createObservabilityContext(config.observability),
  }
}

export function entryFor(ctx: GenerationContext, model: string): JobEntry {
  const entry = ctx.registry.get(model)
  if (!entry)
    throw new ApiJobError('unknown_model', `Unknown model: ${model}`)
  return entry
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
