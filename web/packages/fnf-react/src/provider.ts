'use client'

import type {
  BinaryUploader,
  CharacterBackend,
  CharacterClient,
  FnfObservabilityContext,
  FnfObservabilityOptions,
  GenerationBackend,
  JobClient,
  JobEntry,
  LlmBackend,
  MediaBackend,
  MediaClient,
  ProfileBackend,
  ProfileClient,
  ReferenceBackend,
  ReferenceClient,
  RealtimeBackend,
  RealtimeClient,
  ResolveJobRef,
} from '@higgsfield/fnf'
import type { ReactNode } from 'react'
import { createCharacterClient, createJobClient, createMediaClient, createObservabilityContext, createProfileClient, createRealtimeClient, createReferenceClient } from '@higgsfield/fnf'
import { createContext, createElement, use, useMemo } from 'react'

export interface FnfReactClientsConfig<Jobs extends readonly JobEntry[] = readonly JobEntry[]> {
  adapter: GenerationBackend
  jobs: Jobs
  characterAdapter?: CharacterBackend
  referenceAdapter?: ReferenceBackend
  realtimeAdapter?: RealtimeBackend
  mediaAdapter?: MediaBackend
  profileAdapter?: ProfileBackend
  blobUploader?: BinaryUploader
  resolveJob?: ResolveJobRef
  scopeKey?: string
  observability?: FnfObservabilityOptions
  /**
   * Optional LLM chat/text backend (`createLlmClient`). Worker-side only in
   * generated apps — construct it server-side and pass it through; never mint
   * it in browser code.
   */
  llm?: LlmBackend
}

export interface FnfReactClients<Jobs extends readonly JobEntry[] = readonly JobEntry[]> {
  jobClient: JobClient<Jobs>
  characterClient: CharacterClient
  referenceClient: ReferenceClient
  realtimeClient?: RealtimeClient
  mediaClient: MediaClient
  profileClient: ProfileClient
  llmClient?: LlmBackend
  jobs: Jobs
  scopeKey?: string
  observability?: FnfObservabilityOptions
}

export type FnfProviderProps<Jobs extends readonly JobEntry[] = readonly JobEntry[]> =
  FnfReactClientsConfig<Jobs> & {
    children: ReactNode
  }

const FnfContext = createContext<FnfReactClients | null>(null)

export function createFnfReactClients<const Jobs extends readonly JobEntry[]>(
  config: FnfReactClientsConfig<Jobs>,
): FnfReactClients<Jobs> {
  const mediaAdapter = config.mediaAdapter ?? (config.adapter as unknown as MediaBackend)
  const profileAdapter = config.profileAdapter ?? (config.adapter as unknown as ProfileBackend)
  const characterAdapter = config.characterAdapter ?? (config.adapter as unknown as CharacterBackend)
  const referenceAdapter = config.referenceAdapter ?? (config.adapter as unknown as ReferenceBackend)
  const realtimeAdapter = config.realtimeAdapter ?? asRealtimeBackend(config.adapter)
  const observability = config.observability ? observabilityOptionsFromContext(createObservabilityContext(config.observability)) : undefined
  return {
    jobClient: createJobClient({ adapter: config.adapter, jobs: config.jobs, ...(observability ? { observability } : {}) }),
    characterClient: createCharacterClient({ adapter: characterAdapter, ...(observability ? { observability } : {}) }),
    referenceClient: createReferenceClient({ adapter: referenceAdapter, ...(observability ? { observability } : {}) }),
    ...(realtimeAdapter
      ? {
          realtimeClient: createRealtimeClient({
            adapter: realtimeAdapter,
            jobAdapter: config.adapter,
            ...(config.adapter.confirm ? { confirm: config.adapter.confirm } : {}),
            ...(observability ? { observability } : {}),
          }),
        }
      : {}),
    mediaClient: createMediaClient({
      mediaAdapter,
      ...(config.blobUploader ? { blobUploader: config.blobUploader } : {}),
      ...(config.resolveJob ? { resolveJob: config.resolveJob } : {}),
      ...(observability ? { observability } : {}),
    }),
    profileClient: createProfileClient({ profileAdapter, ...(observability ? { observability } : {}) }),
    ...(config.llm ? { llmClient: config.llm } : {}),
    jobs: config.jobs,
    ...(config.scopeKey ? { scopeKey: config.scopeKey } : {}),
    ...(observability ? { observability } : {}),
  }
}

export function FnfProvider<const Jobs extends readonly JobEntry[]>(props: FnfProviderProps<Jobs>) {
  const {
    children,
    adapter,
    jobs,
    characterAdapter,
    referenceAdapter,
    realtimeAdapter,
    mediaAdapter,
    profileAdapter,
    blobUploader,
    resolveJob,
    scopeKey,
    observability,
    llm,
  } = props
  const value = useMemo(
    () => createFnfReactClients({
      adapter,
      jobs,
      ...(characterAdapter ? { characterAdapter } : {}),
      ...(referenceAdapter ? { referenceAdapter } : {}),
      ...(realtimeAdapter ? { realtimeAdapter } : {}),
      ...(mediaAdapter ? { mediaAdapter } : {}),
      ...(profileAdapter ? { profileAdapter } : {}),
      ...(blobUploader ? { blobUploader } : {}),
      ...(resolveJob ? { resolveJob } : {}),
      ...(scopeKey ? { scopeKey } : {}),
      ...(observability ? { observability } : {}),
      ...(llm ? { llm } : {}),
    }),
    [adapter, jobs, characterAdapter, referenceAdapter, realtimeAdapter, mediaAdapter, profileAdapter, blobUploader, resolveJob, scopeKey, observability, llm],
  )
  return createElement(FnfContext.Provider, { value }, children)
}

export function useFnf<Jobs extends readonly JobEntry[] = readonly JobEntry[]>(): FnfReactClients<Jobs> {
  const value = use(FnfContext)
  if (!value)
    throw new Error('useFnf must be used inside <FnfProvider>')
  return value as FnfReactClients<Jobs>
}

export function useFnfJobClient<Jobs extends readonly JobEntry[] = readonly JobEntry[]>(): JobClient<Jobs> {
  return useFnf<Jobs>().jobClient
}

export function useFnfReferenceClient(): ReferenceClient {
  return useFnf().referenceClient
}

export function useFnfCharacterClient(): CharacterClient {
  return useFnf().characterClient
}

export function useFnfRealtimeClient(): RealtimeClient {
  const client = useFnf().realtimeClient
  if (!client)
    throw new Error('useFnfRealtimeClient requires a realtime-capable adapter passed to <FnfProvider>')
  return client
}

export function useFnfMediaClient(): MediaClient {
  return useFnf().mediaClient
}

export function useFnfProfileClient(): ProfileClient {
  return useFnf().profileClient
}

export function useFnfLlmClient(): LlmBackend {
  const client = useFnf().llmClient
  if (!client)
    throw new Error('useFnfLlmClient requires an `llm` client passed to <FnfProvider>')
  return client
}

export function useFnfJobs<Jobs extends readonly JobEntry[] = readonly JobEntry[]>(): Jobs {
  return useFnf<Jobs>().jobs
}

export function useFnfScopeKey(): string | undefined {
  return useFnf().scopeKey
}

export function useFnfObservability(): FnfObservabilityOptions | undefined {
  return useFnf().observability
}

export function useOptionalFnfObservability(): FnfObservabilityOptions | undefined {
  return use(FnfContext)?.observability
}

function observabilityOptionsFromContext(ctx: FnfObservabilityContext): FnfObservabilityOptions {
  return {
    ...(ctx.observer ? { observer: ctx.observer } : {}),
    traceId: ctx.traceId,
    ...(ctx.parentId ? { parentId: ctx.parentId } : {}),
    attributes: ctx.attributes,
    ...(ctx.onObserverError ? { onObserverError: ctx.onObserverError } : {}),
    now: ctx.now,
    idFactory: ctx.idFactory,
  }
}

function asRealtimeBackend(adapter: GenerationBackend): RealtimeBackend | undefined {
  const candidate = adapter as unknown as Partial<Record<keyof RealtimeBackend, unknown>>
  const methods: Array<keyof RealtimeBackend> = [
    'editRealtimeChain',
    'estimateRealtimeChainCost',
    'finalizeRealtimeChain',
    'listRealtimeCustomStyles',
    'createRealtimeCustomStyle',
    'updateRealtimeCustomStyle',
    'deleteRealtimeCustomStyle',
  ]
  return methods.every(method => typeof candidate[method] === 'function')
    ? adapter as unknown as RealtimeBackend
    : undefined
}
