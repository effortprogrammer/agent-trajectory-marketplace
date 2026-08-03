import type { CharacterBackend, GenerationInput, RealtimeBackend, ReferenceBackend } from '@higgsfield/fnf'
import type { FnfObservationEvent } from '@higgsfield/fnf/observability'
import { defineJob, z } from '@higgsfield/fnf/jobs'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { costQueryOptions } from '../cost-query'
import { fnfKeys } from '../keys'
import { createFnfReactClients } from '../provider'
import { getWirePreview } from '../wire-preview'
import { createMemoryBackend, createMemoryMediaAdapter, createMemoryProfileAdapter } from './test-utils'

const demo = defineJob({
  jobSetType: 'demo',
  outputType: 'image',
  params: {
    prompt: true,
    settings: {
      aspectRatio: z.wire('aspect_ratio', z.aspectRatio(['1:1', '16:9'])),
    },
  },
})

describe('FnfProvider and client creation', () => {
  it('creates stable SDK clients from explicit adapters', async () => {
    const characterAdapter: CharacterBackend = {
      createCharacter: vi.fn(),
      getCharacter: vi.fn(async () => ({ id: 'character-1', type: 'soul_2', status: 'completed' })),
    }
    const referenceAdapter: ReferenceBackend = {
      getReferenceElement: vi.fn(async () => ({
        id: 'element-1',
        name: 'Ada',
        category: 'character',
        status: 'completed',
        medias: [],
        video_medias: [],
        character_id: 'character-1',
      })),
      listReferenceElements: vi.fn(async () => ({ items: [] })),
    }
    const clients = createFnfReactClients({
      adapter: createMemoryBackend(),
      characterAdapter,
      referenceAdapter,
      mediaAdapter: createMemoryMediaAdapter(),
      profileAdapter: createMemoryProfileAdapter({
        user: { id: 'u1', workspace_id: 'w1' },
        workspaces: [{ id: 'w1', name: 'Personal', type: 'private', user_role: 'owner' }],
        currentWorkspaceId: 'w1',
      }),
      jobs: [demo],
      scopeKey: 'u1:w1',
    })

    expect(clients.scopeKey).toBe('u1:w1')
    expect(clients.jobs).toEqual([demo])
    expect(clients.realtimeClient).toBeUndefined()
    await expect(clients.characterClient.get('character-1')).resolves.toMatchObject({ id: 'character-1' })
    await expect(clients.referenceClient.get('element-1')).resolves.toMatchObject({ characterId: 'character-1' })
    await expect(clients.profileClient.getUser()).resolves.toMatchObject({ id: 'u1', workspaceId: 'w1' })
  })

  it('creates the optional realtime client from an explicit adapter', async () => {
    const jobId = '44444444-4444-4444-8444-444444444444'
    const jobSetId = '33333333-3333-4333-8333-333333333333'
    const adapter = createMemoryBackend()
    vi.spyOn(adapter, 'getJob').mockResolvedValue({
      id: jobId,
      job_set_id: jobSetId,
      job_set_type: 'flux_klein_edit',
      status: 'completed',
      result_url: 'https://cdn.example/edit.png',
    })
    const realtimeAdapter: RealtimeBackend = {
      editRealtimeChain: vi.fn(),
      estimateRealtimeChainCost: vi.fn(async () => ({ credits: 1, credits_exact: 0.5 })),
      finalizeRealtimeChain: vi.fn(),
      listRealtimeCustomStyles: vi.fn(async () => ({ items: [], next_cursor: null })),
      createRealtimeCustomStyle: vi.fn(),
      updateRealtimeCustomStyle: vi.fn(),
      deleteRealtimeCustomStyle: vi.fn(),
    }
    const clients = createFnfReactClients({ adapter, realtimeAdapter, jobs: [demo] })

    await expect(clients.realtimeClient?.estimateChainCost({
      resolution: '1k',
      aspectRatio: '1:1',
    })).resolves.toEqual({ credits: 1, creditsExact: 0.5 })
    await expect(clients.realtimeClient?.getEditJob(jobId)).resolves.toMatchObject({
      id: jobId,
      model: 'flux_klein_edit',
      results: { rawUrl: 'https://cdn.example/edit.png' },
    })
  })

  it('passes shared observability into created clients', async () => {
    const events: FnfObservationEvent[] = []
    const clients = createFnfReactClients({
      adapter: createMemoryBackend({ cost: 5 }),
      mediaAdapter: createMemoryMediaAdapter(),
      profileAdapter: createMemoryProfileAdapter(),
      jobs: [demo],
      observability: {
        observer: (event) => {
          events.push(event)
        },
        traceId: 'react-trace',
      },
    })

    await clients.jobClient.cost({ model: 'demo', prompt: { instruction: 'private' }, settings: { aspectRatio: '1:1' } })
    await clients.profileClient.getUser()

    expect(clients.observability?.traceId).toBe('react-trace')
    expect(events.map(event => event.name)).toEqual(expect.arrayContaining(['fnf.job.cost', 'fnf.profile.get_user']))
    expect(events.every(event => event.traceId === 'react-trace')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('private')
  })
})

describe('request helpers', () => {
  it('builds a local wire preview or returns a typed SDK error', () => {
    const input: GenerationInput = { model: 'demo', prompt: { instruction: 'hello' }, settings: { aspectRatio: '16:9' } }
    const preview = getWirePreview(input, [demo])

    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.jobSetType).toBe('demo')
      expect(preview.params).toMatchObject({ prompt: 'hello', aspect_ratio: '16:9' })
    }

    const bad = getWirePreview({ model: 'missing', settings: {} } as never, [demo])
    expect(bad.ok).toBe(false)
    if (!bad.ok)
      expect(bad.error.code).toBe('unknown_model')
  })

  it('caches cost estimates under scoped request keys', async () => {
    const input = { model: 'demo', prompt: { instruction: 'hello' }, settings: { aspectRatio: '1:1' } } as const
    const client = {
      cost: vi.fn(async () => ({ credits: 3 })),
    }
    const qc = new QueryClient()

    await expect(qc.fetchQuery(costQueryOptions(client, input, { scopeKey: 'u1:w1' }))).resolves.toEqual({ credits: 3 })

    expect(client.cost).toHaveBeenCalledWith(input)
    expect(qc.getQueryData(fnfKeys.cost(input, { scopeKey: 'u1:w1' }))).toEqual({ credits: 3 })
    expect(qc.getQueryData(fnfKeys.cost(input))).toBeUndefined()
  })
})
