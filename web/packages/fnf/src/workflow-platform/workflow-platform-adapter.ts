import type { CharacterBackend, ConfirmMediaRequest, ConfirmSubmit, FnfAdapter, JobListQuery, MediaGetQuery, MediaListQuery, RealtimeBackend, ReferenceBackend, SwitchWorkspaceRequest, UploadUrlRequest } from '../backend'
import type { OptionalHeaderSource, RequiredHeaderSource } from '../headers'
import type { FnfObservabilityOptions } from '../observability'
import type { Transport, TransportRequest, TransportResponse } from '../transport'
import { ApiJobError, errorFromResponse } from '../errors'
import { authorizationHeader, cleanHeaders, optionalNamedHeader } from '../headers'
import { withObservedTransport } from '../observability'
import { createFetchTransport } from './fetch-transport'
import { normalizeJobLike, normalizeJobListBody, normalizeJobSetBody } from './job-response-normalize'

export type { FnfAdapter } from '../backend'

export interface WorkflowPlatformAdapterOptions {
  /** Workflow Platform origin. Required unless `transport` is injected. */
  baseUrl?: string
  /** Optional user-scoped token source; sent as `Authorization: Bearer <token>`. */
  getToken?: () => Promise<string | null>
  /** Optional acting user id; sent as `hf-user-id`. */
  userId?: RequiredHeaderSource
  /** Optional active workspace id; sent as `hf-workspace-id`. */
  workspaceId?: OptionalHeaderSource
  /** Optional generated app id; sent as `hf-app-id`. */
  appId?: OptionalHeaderSource
  fetch?: typeof globalThis.fetch
  /** Inject a transport directly (tests / custom). Overrides baseUrl/fetch/header options. */
  transport?: Transport
  observability?: FnfObservabilityOptions
  /**
   * Host confirmation gate run by `submit` before any create request. Its
   * resolved token is sent as `confirmation_token` on the submit body. See
   * `ConfirmSubmit`.
   */
  confirm?: ConfirmSubmit
}

/**
 * Workflow Platform adapter.
 *
 * The SDK keeps doing typed validation and param serialization, then sends
 * static WFP routes. WFP owns final fnf.internal route selection and
 * product-specific request-body quirks. This adapter intentionally stays under:
 * `/user`, `/workspaces/*`, `/reference-elements/*`, `/custom-references/*`,
 * `/realtime/*`, and `/jobs/*`.
 */
export function createWorkflowPlatformAdapter(options: WorkflowPlatformAdapterOptions = {}): FnfAdapter & ReferenceBackend & CharacterBackend & RealtimeBackend {
  if (!options.transport && !options.baseUrl)
    throw new Error('createWorkflowPlatformAdapter requires `baseUrl` or an explicit `transport`')

  const baseTransport = options.transport ?? createFetchTransport({
    baseUrl: (options.baseUrl ?? '').replace(/\/$/, ''),
    headers: async () => cleanHeaders({
      ...(await authorizationHeader(options.getToken)),
      ...(await optionalNamedHeader('hf-user-id', options.userId)),
      ...(await optionalNamedHeader('hf-workspace-id', options.workspaceId)),
      ...(await optionalNamedHeader('hf-app-id', options.appId)),
    }),
    fetch: options.fetch,
  })
  const transport = options.observability ? withObservedTransport(baseTransport, options.observability) : baseTransport

  async function send(method: TransportRequest['method'], path: string, body?: unknown): Promise<unknown> {
    let res: TransportResponse
    try {
      res = await transport({ method, path, body })
    }
    catch (err) {
      if (err instanceof ApiJobError)
        throw err
      throw new ApiJobError('network', `Network error: ${err instanceof Error ? err.message : String(err)}`)
    }

    const normalized = unwrapData(res.body)
    const error = errorFromResponse(res.status, normalized)
    if (error)
      throw error
    return normalized
  }

  return {
    // ── jobs ──
    ...(options.confirm ? { confirm: options.confirm } : {}),
    createJobs: ({ jobSetType, params, confirmationToken }) => send('POST', '/jobs/submit', {
      job_set_type: jobSetType,
      params,
      ...(confirmationToken !== undefined ? { confirmation_token: confirmationToken } : {}),
    }),

    getJob: async id => normalizeJobReadBody(await send('GET', `/jobs/${encodeURIComponent(id)}`)),

    getJobSet: async id => normalizeJobSetBody(await send('GET', `/jobs/sets/${encodeURIComponent(id)}`)),

    async listJobs(query) {
      if (query.parentId !== undefined)
        throw new ApiJobError('not_supported', 'GET /jobs has no parent filter - the Workflow Platform feed cannot list a job set\'s children (parentId)')
      return normalizeJobListBody(await send('GET', jobsFeedPath(query)))
    },

    estimateCost: ({ jobSetType, params }) => send('POST', '/jobs/cost', {
      job_set_type: jobSetType,
      params,
    }),

    createCharacter: req => send('POST', '/custom-references', req),

    getCharacter: id => send('GET', `/custom-references/${encodeURIComponent(id)}`),

    getReferenceElement: id => send('GET', `/reference-elements/${encodeURIComponent(id)}`),

    listReferenceElements: query => send('GET', referenceListPath(query)),

    editRealtimeChain: req => send('POST', '/realtime/chain/edit', req),

    estimateRealtimeChainCost: req => send('POST', '/realtime/chain/cost', req),

    finalizeRealtimeChain: req => send('POST', '/realtime/chain/finalize', req),

    listRealtimeCustomStyles: query => send('GET', realtimeCustomStylesPath(query)),

    createRealtimeCustomStyle: req => send('POST', '/realtime/custom-styles', req),

    updateRealtimeCustomStyle: (styleId, req) => send(
      'PATCH',
      `/realtime/custom-styles/${encodeURIComponent(styleId)}`,
      req,
    ),

    deleteRealtimeCustomStyle: styleId => send(
      'DELETE',
      `/realtime/custom-styles/${encodeURIComponent(styleId)}`,
    ),

    cancelJob: id => send('POST', `/jobs/${encodeURIComponent(id)}/cancel`),

    // ── media through WFP /jobs static routes ──
    getMedia: query => send('GET', mediaGetPath(query)),

    listMedia: query => send('GET', mediaListPath(query)),

    getUploadUrl: req => send('POST', '/jobs/media/presign', mediaPresignBody(req)),

    confirmMedia: req => send(
      'POST',
      `/jobs/media/${encodeURIComponent(req.mediaId)}/confirm`,
      mediaConfirmBody(req),
    ),

    // ── profile ──
    getUser: () => send('GET', '/user'),

    listWorkspaces: () => send('GET', '/workspaces'),

    getCurrentWorkspace: () => send('GET', '/workspaces/current'),

    getWorkspaceWallet: () => send('GET', '/workspaces/wallet'),

    switchWorkspace: (req: SwitchWorkspaceRequest) => send('POST', '/workspaces/switch', {
      workspace_id: req.workspaceId,
    }),
  }
}

function realtimeCustomStylesPath(query: { cursor?: number, size?: number }): string {
  const search = new URLSearchParams()
  if (query.cursor !== undefined)
    search.set('cursor', String(query.cursor))
  if (query.size !== undefined)
    search.set('size', String(query.size))
  const suffix = search.toString()
  return suffix ? `/realtime/custom-styles?${suffix}` : '/realtime/custom-styles'
}

function referenceListPath(query: { cursor?: number, size?: number, category?: string }): string {
  const search = new URLSearchParams()
  if (query.cursor !== undefined)
    search.set('cursor', String(query.cursor))
  if (query.size !== undefined)
    search.set('size', String(query.size))
  if (query.category !== undefined)
    search.set('category', query.category)
  const suffix = search.toString()
  return suffix ? `/reference-elements?${suffix}` : '/reference-elements'
}

function unwrapData(body: unknown): unknown {
  if (isRecord(body) && Object.prototype.hasOwnProperty.call(body, 'data'))
    return body.data
  return body
}

function normalizeJobReadBody(body: unknown): unknown {
  if (isRecord(body) && isRecord(body.job))
    return normalizeJobLike(body.job, body.job_set)
  if (isRecord(body))
    return normalizeJobLike(body)
  return body
}

function jobsFeedPath(query: JobListQuery): string {
  const search = new URLSearchParams()
  append(search, 'gen_type', query.type)
  append(search, 'cursor', query.cursor)
  append(search, 'size', query.size)
  appendMany(search, 'status', query.status)
  appendMany(search, 'job_set_type', query.model)
  const qs = search.toString()
  return qs ? `/jobs?${qs}` : '/jobs'
}

function mediaGetPath(query: MediaGetQuery): string {
  return pathWithQuery(`/jobs/media/${encodeURIComponent(query.id)}`, {
    type: query.type,
  })
}

function mediaListPath(query: MediaListQuery): string {
  return pathWithQuery('/jobs/media', {
    type: query.type,
    cursor: query.cursor,
    size: query.size,
  })
}

function mediaPresignBody(req: UploadUrlRequest): Record<string, unknown> {
  return cleanBody({
    type: req.type,
    filename: req.filename,
    content_type: req.contentType,
    extra: req.extra,
  })
}

function mediaConfirmBody(req: ConfirmMediaRequest): Record<string, unknown> {
  return cleanBody({
    type: req.type,
    filename: req.filename,
    job_id: req.jobId,
    force_ip_check: req.forceIpCheck,
    force_nsfw_check: req.forceNsfwCheck,
    start_seconds: req.startSeconds,
    end_seconds: req.endSeconds,
    extra: req.extra,
  })
}

function pathWithQuery(path: string, query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    append(search, key, value)
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

function append(search: URLSearchParams, key: string, value: string | number | undefined): void {
  if (value !== undefined)
    search.append(key, String(value))
}

function appendMany(search: URLSearchParams, key: string, value: string | string[] | undefined): void {
  if (Array.isArray(value)) {
    for (const item of value)
      search.append(key, item)
    return
  }
  if (value !== undefined)
    search.append(key, value)
}

function cleanBody<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined)
      out[key] = value
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
