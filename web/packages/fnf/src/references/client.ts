import type { ReferenceBackend } from '../backend'
import type {
  Reference,
  ReferenceListQuery,
  ReferenceListResult,
  ReferenceWaitOptions,
} from './types'
import type { FnfObservabilityOptions } from '../observability'
import { ApiJobError, JobAbortedError, JobTimeoutError } from '../errors'
import { createObservabilityContext, observeAsync } from '../observability'
import { parseReference } from './codec'

export interface ReferenceClientConfig {
  adapter: ReferenceBackend
  poll?: { intervalMs?: number, timeoutMs?: number }
  scheduler?: { sleep?: (milliseconds: number) => Promise<void> }
  observability?: FnfObservabilityOptions
}

export interface ReferenceClient {
  get: (id: string) => Promise<Reference>
  list: (query?: ReferenceListQuery) => Promise<ReferenceListResult>
  wait: (reference: Reference, options?: ReferenceWaitOptions) => Promise<Reference>
}

const DEFAULT_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 600_000

function isTerminal(reference: Reference): boolean {
  return reference.status !== 'processing' && reference.status !== 'ip_checking'
}

export function createReferenceClient(config: ReferenceClientConfig): ReferenceClient {
  const observability = createObservabilityContext(config.observability)
  const intervalMs = config.poll?.intervalMs ?? DEFAULT_INTERVAL_MS
  const timeoutMs = config.poll?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = config.scheduler?.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))

  const get = (id: string): Promise<Reference> => observeAsync(
    observability,
    'fnf.reference.get',
    { reference_id: id },
    async () => {
      if (!config.adapter.getReferenceElement)
        throw new ApiJobError('not_supported', 'Reference reads are not supported by this adapter')
      return parseReference(await config.adapter.getReferenceElement(id))
    },
    { successAttributes: reference => ({ reference_id: reference.id, status: reference.status }) },
  )

  const client: ReferenceClient = {
    get,
    list: (query = {}) => observeAsync(observability, 'fnf.reference.list', {}, async () => {
      if (!config.adapter.listReferenceElements)
        throw new ApiJobError('not_supported', 'Reference listing is not supported by this adapter')
      const body = await config.adapter.listReferenceElements(query)
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        throw new ApiJobError('invalid_response', 'Invalid reference list response')
      const page = body as { items?: unknown, next_cursor?: unknown, cursor?: unknown, has_more?: unknown }
      if (!Array.isArray(page.items))
        throw new ApiJobError('invalid_response', 'Invalid reference list response')
      const rawCursor = page.next_cursor ?? page.cursor
      const nextCursor = page.has_more === false
        ? undefined
        : typeof rawCursor === 'number' ? rawCursor : undefined
      return {
        items: page.items.map(parseReference),
        ...(nextCursor !== undefined ? { nextCursor } : {}),
      }
    }, { successAttributes: page => ({ reference_count: page.items.length }) }),
    wait: async (reference, options = {}) => {
      if (isTerminal(reference))
        return reference
      const startedAt = Date.now()
      const waitIntervalMs = options.intervalMs ?? intervalMs
      const waitTimeoutMs = options.timeoutMs ?? timeoutMs
      let current = reference
      while (Date.now() - startedAt < waitTimeoutMs) {
        if (options.signal?.aborted)
          throw new JobAbortedError()
        await sleep(waitIntervalMs)
        if (options.signal?.aborted)
          throw new JobAbortedError()
        current = await get(reference.id)
        options.onProgress?.(current)
        if (isTerminal(current))
          return current
      }
      throw new JobTimeoutError(reference.id, waitTimeoutMs)
    },
  }

  return client
}
