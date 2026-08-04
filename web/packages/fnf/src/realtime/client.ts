import type { ConfirmSubmit, GenerationBackend, RealtimeBackend } from '../backend'
import type { FnfObservabilityOptions } from '../observability'
import type { Generation } from '../types'
import type {
  CreateRealtimeCustomStyleInput,
  RealtimeChainCostEstimate,
  RealtimeChainCostInput,
  RealtimeChainEditInput,
  RealtimeChainEditOptions,
  RealtimeChainEditResult,
  RealtimeChainFinalizeInput,
  RealtimeChainFinalizeResult,
  RealtimeCustomStyle,
  RealtimeCustomStyleListQuery,
  RealtimeCustomStyleListResult,
  RealtimeEditPollOptions,
  UpdateRealtimeCustomStyleInput,
} from './types'
import { createContext } from '../client/context'
import { getGeneration } from '../client/get'
import { pollGeneration } from '../client/poll'
import { defineJob } from '../define-job'
import { ApiJobError, ConfirmationRejectedError } from '../errors'
import { createObservabilityContext, observeAsync } from '../observability'
import {
  buildCreateRealtimeCustomStyleRequest,
  buildRealtimeChainCostRequest,
  buildRealtimeChainEditRequest,
  buildRealtimeChainFinalizeRequest,
  buildUpdateRealtimeCustomStyleRequest,
  parseRealtimeChainCostEstimate,
  parseRealtimeChainEditResult,
  parseRealtimeChainFinalizeResult,
  parseRealtimeCustomStyle,
  parseRealtimeCustomStyleList,
  requireRealtimeUuid,
  validateRealtimeCustomStyleListQuery,
} from './codec'

const REALTIME_EDIT_READ_ENTRY = defineJob({
  jobSetType: 'flux_klein_edit',
  outputType: 'image',
  params: { settings: {} },
})

async function requestSubmitConfirmation(
  confirm: ConfirmSubmit,
  request: Parameters<ConfirmSubmit>[0],
): Promise<string | undefined> {
  let token: string | void
  try {
    token = await confirm(request)
  }
  catch (error) {
    throw error instanceof ApiJobError
      ? error
      : new ConfirmationRejectedError(error instanceof Error ? error.message : undefined)
  }
  return typeof token === 'string' ? token : undefined
}

export interface RealtimeClientConfig {
  adapter: RealtimeBackend
  /** The same host confirmation contract used by normal generation submits. */
  confirm?: ConfirmSubmit
  /** Optional job read port for getEditJob/pollEditJob. */
  jobAdapter?: Pick<GenerationBackend, 'getJob'>
  /** Direct job reader; takes precedence over jobAdapter. */
  getJob?: GenerationBackend['getJob']
  poll?: { intervalMs?: number, timeoutMs?: number }
  scheduler?: { sleep?: (ms: number) => Promise<void>, isActive?: () => boolean }
  observability?: FnfObservabilityOptions
}

export interface RealtimeClient {
  /** Submit exactly one attempt. This operation is intentionally never retried. */
  editChain: (input: RealtimeChainEditInput, options?: RealtimeChainEditOptions) => Promise<RealtimeChainEditResult>
  /** Read one realtime edit result through the shared generation parser. */
  getEditJob: (jobId: string) => Promise<Generation>
  /** Poll one realtime edit to a terminal generation state. */
  pollEditJob: (jobId: string, options?: RealtimeEditPollOptions) => Promise<Generation>
  estimateChainCost: (input: RealtimeChainCostInput) => Promise<RealtimeChainCostEstimate>
  finalizeChain: (input: RealtimeChainFinalizeInput) => Promise<RealtimeChainFinalizeResult>
  listCustomStyles: (query?: RealtimeCustomStyleListQuery) => Promise<RealtimeCustomStyleListResult>
  createCustomStyle: (input: CreateRealtimeCustomStyleInput) => Promise<RealtimeCustomStyle>
  updateCustomStyle: (styleId: string, input: UpdateRealtimeCustomStyleInput) => Promise<RealtimeCustomStyle>
  deleteCustomStyle: (styleId: string) => Promise<void>
}

export function createRealtimeClient(config: RealtimeClientConfig): RealtimeClient {
  const observability = createObservabilityContext(config.observability)
  // Match createJobClient's compatibility bridge: generated-app adapters may
  // still carry the host callback while callers migrate to explicit clients.
  const confirm = config.confirm ?? (config.adapter as RealtimeBackend & { confirm?: ConfirmSubmit }).confirm
  const editJobContext = createEditJobContext(config)

  return {
    editChain: (input, options = {}) => observeAsync(observability, 'fnf.realtime.edit_chain', {
      continuing_chain: input.chainId !== undefined && input.chainId !== null,
    }, async () => {
      const wire = buildRealtimeChainEditRequest(input)
      const confirmationToken = options.confirmationToken ?? (confirm
        ? await requestSubmitConfirmation(confirm, {
            jobSetType: 'flux_klein_realtime',
            // Approval hashes the exact edit body that will be submitted,
            // before the opaque token itself is attached.
            params: wire,
          })
        : undefined)
      const request = confirmationToken === undefined
        ? wire
        : { ...wire, confirmation_token: confirmationToken }
      return parseRealtimeChainEditResult(await config.adapter.editRealtimeChain(request))
    }, {
      successAttributes: result => ({
        chain_id: result.chainId,
        job_set_id: result.jobSetId,
        job_id: result.jobId,
        status: result.status,
      }),
    }),

    getEditJob: (jobId) => {
      const id = requireRealtimeUuid(jobId, 'jobId')
      return getGeneration(requireEditJobContext(editJobContext), id, REALTIME_EDIT_READ_ENTRY)
    },

    pollEditJob: (jobId, options = {}) => {
      const id = requireRealtimeUuid(jobId, 'jobId')
      return pollGeneration(requireEditJobContext(editJobContext), id, {
        ...options,
        entry: REALTIME_EDIT_READ_ENTRY,
      })
    },

    estimateChainCost: input => observeAsync(observability, 'fnf.realtime.estimate_chain_cost', {
      mode: input.mode ?? 'advanced',
      resolution: input.resolution,
    }, async () => parseRealtimeChainCostEstimate(
      await config.adapter.estimateRealtimeChainCost(buildRealtimeChainCostRequest(input)),
    )),

    finalizeChain: input => observeAsync(observability, 'fnf.realtime.finalize_chain', {
      chain_id: input.chainId,
    }, async () => parseRealtimeChainFinalizeResult(
      await config.adapter.finalizeRealtimeChain(buildRealtimeChainFinalizeRequest(input)),
    ), { successAttributes: result => ({ chain_id: result.chainId, status: result.status }) }),

    listCustomStyles: (query = {}) => observeAsync(observability, 'fnf.realtime.list_custom_styles', {}, async () => {
      validateRealtimeCustomStyleListQuery(query)
      return parseRealtimeCustomStyleList(await config.adapter.listRealtimeCustomStyles(query))
    }, { successAttributes: result => ({ style_count: result.items.length }) }),

    createCustomStyle: input => observeAsync(observability, 'fnf.realtime.create_custom_style', {}, async () => (
      parseRealtimeCustomStyle(await config.adapter.createRealtimeCustomStyle(buildCreateRealtimeCustomStyleRequest(input)))
    ), { successAttributes: result => ({ style_id: result.id }) }),

    updateCustomStyle: (styleId, input) => observeAsync(observability, 'fnf.realtime.update_custom_style', {
      style_id: styleId,
    }, async () => {
      requireRealtimeUuid(styleId, 'styleId')
      return parseRealtimeCustomStyle(await config.adapter.updateRealtimeCustomStyle(
        styleId,
        buildUpdateRealtimeCustomStyleRequest(input),
      ))
    }, { successAttributes: result => ({ style_id: result.id }) }),

    deleteCustomStyle: (styleId) => observeAsync(observability, 'fnf.realtime.delete_custom_style', {
      style_id: styleId,
    }, async () => {
      requireRealtimeUuid(styleId, 'styleId')
      await config.adapter.deleteRealtimeCustomStyle(styleId)
    }),
  }
}

function createEditJobContext(config: RealtimeClientConfig) {
  const adapterWithJobRead = config.adapter as RealtimeBackend & Partial<Pick<GenerationBackend, 'getJob'>>
  const adapterGetJob = adapterWithJobRead.getJob
  const jobAdapter = config.jobAdapter
  const getJob = config.getJob
    ?? (jobAdapter ? (id: string) => jobAdapter.getJob(id) : undefined)
    ?? (typeof adapterGetJob === 'function' ? (id: string) => adapterGetJob.call(adapterWithJobRead, id) : undefined)
  if (!getJob)
    return undefined

  return createContext({
    adapter: readOnlyGenerationAdapter(getJob),
    jobs: [REALTIME_EDIT_READ_ENTRY],
    ...(config.poll ? { poll: config.poll } : {}),
    ...(config.scheduler ? { scheduler: config.scheduler } : {}),
    ...(config.observability ? { observability: config.observability } : {}),
  })
}

function requireEditJobContext(context: ReturnType<typeof createEditJobContext>) {
  if (!context) {
    throw new ApiJobError(
      'not_supported',
      'Realtime edit job reads require `jobAdapter`, `getJob`, or a realtime adapter with `getJob`',
    )
  }
  return context
}

function readOnlyGenerationAdapter(getJob: GenerationBackend['getJob']): GenerationBackend {
  const unsupported = async (): Promise<never> => {
    throw new ApiJobError('not_supported', 'The realtime edit reader supports job reads only')
  }
  return {
    createJobs: unsupported,
    getJob,
    listJobs: unsupported,
    estimateCost: unsupported,
  }
}
