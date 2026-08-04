import type { ProfileClientConfig, ProfileContext } from './types'
import { createObservabilityContext } from '../observability'

/** Resolve profile config into the shared context every profile operation consumes. */
export function createProfileContext(config: ProfileClientConfig): ProfileContext {
  return {
    profileAdapter: config.profileAdapter,
    observability: createObservabilityContext(config.observability),
  }
}
