import type { MediaClientConfig, MediaContext } from './types'
import { createObservabilityContext } from '../observability'
import { createFetchUploader } from './blob-uploader'

/** Resolve media config into the shared context every media operation consumes. */
export function createMediaContext(config: MediaClientConfig): MediaContext {
  return {
    mediaAdapter: config.mediaAdapter,
    blobUploader: config.blobUploader ?? createFetchUploader(),
    resolveJob: config.resolveJob,
    observability: createObservabilityContext(config.observability),
  }
}
