import type { FnfAdapter, RealtimeBackend } from '../../backend'
import type { Transport, TransportRequest } from '../../transport'
import { describe, expect, it, vi } from 'vitest'
import { createJobClient, getPreviewUrl, getRawUrl } from '../../client'
import { nanoBanana2, seedance2_0 } from '../../jobs'
import { createWorkflowPlatformAdapter } from '../workflow-platform-adapter'

const okTransport: Transport = async () => ({ status: 200, body: {} })
const characterImages = Array.from({ length: 5 }, (_, index) => ({
  id: `media-${index + 1}`,
  type: 'media_input' as const,
}))

function createRecordingAdapter(bodyFor?: (req: TransportRequest) => unknown): {
  adapter: FnfAdapter & RealtimeBackend
  calls: TransportRequest[]
} {
  const calls: TransportRequest[] = []
  const adapter = createWorkflowPlatformAdapter({
    transport: async (req) => {
      calls.push(req)
      return { status: 200, body: bodyFor?.(req) ?? {} }
    },
  })
  return { adapter, calls }
}

describe('createWorkflowPlatformAdapter realtime operations', () => {
  it('uses static realtime routes and preserves wire bodies', async () => {
    const { adapter, calls } = createRecordingAdapter()
    const params = {
      prompt: 'Make this cinematic',
      mode: 'advanced' as const,
      resolution: '2k' as const,
      aspect_ratio: '16:9' as const,
      medias: [{ role: 'image' as const, data: { id: 'media-1', type: 'media_input' as const } }],
    }

    await adapter.editRealtimeChain({ chain_id: 'chain-1', params, confirmation_token: 'approved' })
    await adapter.estimateRealtimeChainCost({ mode: 'advanced', resolution: '2k', aspect_ratio: '16:9' })
    await adapter.finalizeRealtimeChain({ chain_id: 'chain-1' })
    await adapter.listRealtimeCustomStyles({ cursor: 123.5, size: 20 })
    await adapter.createRealtimeCustomStyle({ prompt: 'soft flash' })
    await adapter.updateRealtimeCustomStyle('style/1', { prompt: 'hard flash', clear_reference: true })
    await adapter.deleteRealtimeCustomStyle('style/1')

    expect(calls.map(call => ({ method: call.method, path: call.path, body: call.body }))).toEqual([
      { method: 'POST', path: '/realtime/chain/edit', body: { chain_id: 'chain-1', params, confirmation_token: 'approved' } },
      { method: 'POST', path: '/realtime/chain/cost', body: { mode: 'advanced', resolution: '2k', aspect_ratio: '16:9' } },
      { method: 'POST', path: '/realtime/chain/finalize', body: { chain_id: 'chain-1' } },
      { method: 'GET', path: '/realtime/custom-styles?cursor=123.5&size=20', body: undefined },
      { method: 'POST', path: '/realtime/custom-styles', body: { prompt: 'soft flash' } },
      { method: 'PATCH', path: '/realtime/custom-styles/style%2F1', body: { prompt: 'hard flash', clear_reference: true } },
      { method: 'DELETE', path: '/realtime/custom-styles/style%2F1', body: undefined },
    ])
  })
})

describe('createWorkflowPlatformAdapter construction', () => {
  it('requires a baseUrl or injected transport', () => {
    expect(() => createWorkflowPlatformAdapter()).toThrow(/baseUrl.*transport/i)
    expect(() => createWorkflowPlatformAdapter({ transport: okTransport })).not.toThrow()
    expect(() => createWorkflowPlatformAdapter({ baseUrl: 'https://wfp.example' })).not.toThrow()
  })

  it('sends configured auth and context headers over fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'u1' }), { status: 200 }))
    const adapter = createWorkflowPlatformAdapter({
      baseUrl: 'https://wfp.example/',
      getToken: async () => 'token-1',
      userId: async () => 'user-1',
      workspaceId: async () => 'workspace-1',
      appId: async () => 'app-1',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    await adapter.getUser()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Headers
    expect(url).toBe('https://wfp.example/user')
    expect(headers.get('authorization')).toBe('Bearer token-1')
    expect(headers.get('hf-user-id')).toBe('user-1')
    expect(headers.get('hf-workspace-id')).toBe('workspace-1')
    expect(headers.get('hf-app-id')).toBe('app-1')
  })
})

describe('createWorkflowPlatformAdapter profile operations', () => {
  it('uses static WFP profile endpoints', async () => {
    const { adapter, calls } = createRecordingAdapter()

    await adapter.getUser()
    await adapter.listWorkspaces()
    await adapter.getCurrentWorkspace()
    await adapter.getWorkspaceWallet()
    await adapter.switchWorkspace({ workspaceId: 'workspace-1' })

    expect(calls.map(call => ({ method: call.method, path: call.path, body: call.body }))).toEqual([
      { method: 'GET', path: '/user', body: undefined },
      { method: 'GET', path: '/workspaces', body: undefined },
      { method: 'GET', path: '/workspaces/current', body: undefined },
      { method: 'GET', path: '/workspaces/wallet', body: undefined },
      {
        method: 'POST',
        path: '/workspaces/switch',
        body: { workspace_id: 'workspace-1' },
      },
    ])
  })
})

describe('createWorkflowPlatformAdapter job operations', () => {
  it('serializes submit, cost, reads, list, and cancel through static /jobs routes', async () => {
    const { adapter, calls } = createRecordingAdapter()

    await adapter.createJobs({
      jobSetType: 'seedance_2_0',
      params: { prompt: 'x', duration: 5 },
      confirmationToken: 'intent-1',
    })
    await adapter.estimateCost({ jobSetType: 'seedance_2_0', params: { duration: 5 } })
    await adapter.getJob('job-1')
    await adapter.getJobSet?.('set-1')
    await adapter.listJobs({
      type: 'video',
      cursor: 'cursor-1',
      size: 20,
      status: ['queued', 'completed'],
      model: ['seedance_2_0', 'kling3_0'],
    })
    await adapter.cancelJob?.('job-1')
    await adapter.createCharacter?.({
      name: 'Ada',
      type: 'soul_cinematic',
      input_images: characterImages,
    })
    await adapter.getCharacter?.('character-1')
    await adapter.getReferenceElement?.('element-1')
    await adapter.listReferenceElements?.({ cursor: 123.5, size: 20, category: 'character' })

    expect(calls.map(call => ({ method: call.method, path: call.path, body: call.body }))).toEqual([
      {
        method: 'POST',
        path: '/jobs/submit',
        body: {
          job_set_type: 'seedance_2_0',
          params: { prompt: 'x', duration: 5 },
          confirmation_token: 'intent-1',
        },
      },
      {
        method: 'POST',
        path: '/jobs/cost',
        body: {
          job_set_type: 'seedance_2_0',
          params: { duration: 5 },
        },
      },
      { method: 'GET', path: '/jobs/job-1', body: undefined },
      { method: 'GET', path: '/jobs/sets/set-1', body: undefined },
      {
        method: 'GET',
        path: '/jobs?gen_type=video&cursor=cursor-1&size=20&status=queued&status=completed&job_set_type=seedance_2_0&job_set_type=kling3_0',
        body: undefined,
      },
      {
        method: 'POST',
        path: '/jobs/job-1/cancel',
        body: undefined,
      },
      {
        method: 'POST',
        path: '/custom-references',
        body: {
          name: 'Ada',
          type: 'soul_cinematic',
          input_images: characterImages,
        },
      },
      { method: 'GET', path: '/custom-references/character-1', body: undefined },
      { method: 'GET', path: '/reference-elements/element-1', body: undefined },
      { method: 'GET', path: '/reference-elements?cursor=123.5&size=20&category=character', body: undefined },
    ])
  })

  it('rejects parent-id list filters because the WFP feed route cannot support them', async () => {
    const { adapter } = createRecordingAdapter()

    await expect(adapter.listJobs({ type: 'image', parentId: 'parent-1' })).rejects.toMatchObject({
      code: 'not_supported',
    })
  })

  it('unwraps WFP { data } responses', async () => {
    const adapter = createWorkflowPlatformAdapter({
      transport: async () => ({ status: 200, body: { data: { credits: 23 } } }),
    })

    await expect(adapter.estimateCost({ jobSetType: 'seedance_2_0', params: {} })).resolves.toEqual({ credits: 23 })
  })

  it('normalizes flat completed image reads into SDK result urls', async () => {
    const adapter = createWorkflowPlatformAdapter({
      transport: async () => ({
        status: 200,
        body: {
          id: 'job-1',
          job_set_type: 'nano_banana_2',
          status: 'completed',
          result_url: 'https://cdn.example/raw.png',
          min_result_url: 'https://cdn.example/min.webp',
          params: { prompt: 'portrait' },
        },
      }),
    })
    const client = createJobClient({ adapter, jobs: [nanoBanana2] })

    const generation = await client.get('job-1')

    expect(generation.results).toEqual({
      rawUrl: 'https://cdn.example/raw.png',
      minUrl: 'https://cdn.example/min.webp',
    })
    expect(getRawUrl(generation)).toBe('https://cdn.example/raw.png')
    expect(getPreviewUrl(generation)).toBe('https://cdn.example/min.webp')
    expect(generation.input.prompt?.instruction).toBe('portrait')
  })

  it('normalizes nested product feed results for listJobs', async () => {
    const adapter = createWorkflowPlatformAdapter({
      transport: async () => ({
        status: 200,
        body: {
          jobs: [
            {
              id: 'job-1',
              job_set_type: 'nano_banana_2',
              job_set_id: 'set-1',
              status: 'completed',
              results: {
                raw: { url: 'https://cdn.example/raw.png' },
                min: { url: 'https://cdn.example/min.webp' },
              },
              params: { prompt: 'history prompt' },
              created_at: 123,
            },
          ],
          has_more: false,
        },
      }),
    })
    const client = createJobClient({ adapter, jobs: [nanoBanana2] })

    const list = await client.list({ type: 'image', size: 50 })

    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      id: 'job-1',
      jobSetId: 'set-1',
      status: 'completed',
      results: {
        rawUrl: 'https://cdn.example/raw.png',
        minUrl: 'https://cdn.example/min.webp',
      },
      createdAt: 123,
    })
    expect(getPreviewUrl(list.items[0]!)).toBe('https://cdn.example/min.webp')
    expect(list.items[0]?.input.prompt?.instruction).toBe('history prompt')
  })

  it('normalizes job-set product payloads and video thumbnail urls', async () => {
    const adapter = createWorkflowPlatformAdapter({
      transport: async () => ({
        status: 200,
        body: {
          id: 'set-1',
          type: 'seedance_2_0',
          params: { prompt: 'video prompt', duration: 5, aspect_ratio: '16:9', resolution: '720p' },
          jobs: [
            {
              id: 'job-1',
              status: 'completed',
              result_url: 'https://cdn.example/video.mp4',
              thumbnail_url: 'https://cdn.example/thumb.webp',
            },
          ],
        },
      }),
    })
    const client = createJobClient({ adapter, jobs: [seedance2_0] })

    const [generation] = await client.getSet('set-1')

    expect(generation).toMatchObject({
      id: 'job-1',
      jobSetId: 'set-1',
      model: 'seedance_2_0',
      type: 'video',
      status: 'completed',
      results: {
        rawUrl: 'https://cdn.example/video.mp4',
        thumbnailUrl: 'https://cdn.example/thumb.webp',
      },
    })
    expect(getRawUrl(generation!)).toBe('https://cdn.example/video.mp4')
    expect(getPreviewUrl(generation!)).toBe('https://cdn.example/thumb.webp')
    expect(generation?.input.prompt?.instruction).toBe('video prompt')
  })
})

describe('createWorkflowPlatformAdapter media operations', () => {
  it('serializes presign and confirm through static /jobs media routes', async () => {
    const { adapter, calls } = createRecordingAdapter()

    await adapter.getUploadUrl?.({ type: 'image', filename: 'frame.png', contentType: 'image/png', extra: { surface: 'test' } })
    await adapter.getUploadUrl?.({ type: 'video', filename: 'clip.mp4', contentType: 'video/mp4' })
    await adapter.getUploadUrl?.({ type: 'audio', filename: 'audio.mp3', contentType: 'audio/mpeg' })
    await adapter.confirmMedia?.({
      mediaId: 'media-1',
      type: 'image',
      filename: 'frame.png',
      jobId: 'job-1',
      forceIpCheck: true,
      forceNsfwCheck: false,
      startSeconds: 1,
      endSeconds: 3,
      extra: { role: 'start_image' },
    })

    expect(calls.map(call => ({ method: call.method, path: call.path, body: call.body }))).toEqual([
      {
        method: 'POST',
        path: '/jobs/media/presign',
        body: {
          type: 'image',
          filename: 'frame.png',
          content_type: 'image/png',
          extra: { surface: 'test' },
        },
      },
      {
        method: 'POST',
        path: '/jobs/media/presign',
        body: {
          type: 'video',
          filename: 'clip.mp4',
          content_type: 'video/mp4',
        },
      },
      {
        method: 'POST',
        path: '/jobs/media/presign',
        body: {
          type: 'audio',
          filename: 'audio.mp3',
          content_type: 'audio/mpeg',
        },
      },
      {
        method: 'POST',
        path: '/jobs/media/media-1/confirm',
        body: {
          type: 'image',
          filename: 'frame.png',
          job_id: 'job-1',
          force_ip_check: true,
          force_nsfw_check: false,
          start_seconds: 1,
          end_seconds: 3,
          extra: { role: 'start_image' },
        },
      },
    ])
  })

  it('serializes media reads through static /jobs media routes', async () => {
    const { adapter, calls } = createRecordingAdapter()

    await adapter.getMedia({ id: 'media-1', type: 'image' })
    await adapter.listMedia({ type: 'video', cursor: 'cursor-1', size: 15 })

    expect(calls.map(call => ({ method: call.method, path: call.path, body: call.body }))).toEqual([
      { method: 'GET', path: '/jobs/media/media-1?type=image', body: undefined },
      { method: 'GET', path: '/jobs/media?type=video&cursor=cursor-1&size=15', body: undefined },
    ])
  })
})

describe('createWorkflowPlatformAdapter safety and errors', () => {
  it('never calls direct fnf-web, media, marketplace, or workspace-detail routes', async () => {
    const { adapter, calls } = createRecordingAdapter()

    await adapter.createJobs({ jobSetType: 'gpt_image_2', params: { use_unlim: true } })
    await adapter.estimateCost({ jobSetType: 'gpt_image_2', params: { use_unlim: true } })
    await adapter.getJob('job-1')
    await adapter.getJobSet?.('set-1')
    await adapter.listJobs({ type: 'image' })
    await adapter.cancelJob?.('job-1')
    await adapter.getUploadUrl?.({ type: 'image' })
    await adapter.confirmMedia?.({ mediaId: 'media-1', type: 'image' })
    await adapter.getMedia({ id: 'media-1', type: 'image' })
    await adapter.listMedia({ type: 'image' })
    await adapter.getUser()
    await adapter.listWorkspaces()
    await adapter.getCurrentWorkspace()
    await adapter.getWorkspaceWallet()
    await adapter.switchWorkspace({ workspaceId: 'workspace-1' })

    const paths = calls.map(call => call.path).join('\n')
    for (const forbidden of ['/jobs/v2', '/job-sets', '/apps-marketplace', '/workspaces/details', '/workspaces/context'])
      expect(paths).not.toContain(forbidden)

    for (const forbiddenPrefix of ['/media', '/video', '/audio'])
      expect(calls.some(call => call.path.startsWith(forbiddenPrefix))).toBe(false)
  })

  it('maps typed HTTP errors through the existing error catalog', async () => {
    const adapter = createWorkflowPlatformAdapter({
      transport: async () => ({
        status: 403,
        body: { data: { detail: { error_type: 'workspace_selection_required' } } },
      }),
    })

    await expect(adapter.getUser()).rejects.toMatchObject({ code: 'workspace_selection_required' })
  })

  it('wraps thrown transport errors as ApiJobError network failures', async () => {
    const adapter = createWorkflowPlatformAdapter({
      transport: async () => {
        throw new Error('socket closed')
      },
    })

    await expect(adapter.getUser()).rejects.toMatchObject({
      code: 'network',
      message: 'Network error: socket closed',
    })
  })

  it('does not expose token, user id, workspace id, or app id in observability events', async () => {
    const events: unknown[] = []
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'u1' }), { status: 200 }))
    const adapter = createWorkflowPlatformAdapter({
      baseUrl: 'https://wfp.example',
      getToken: async () => 'secret-token',
      userId: 'user-sensitive',
      workspaceId: 'workspace-sensitive',
      appId: 'app-sensitive',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      observability: {
        observer: (event) => {
          events.push(event)
        },
        idFactory: () => `id-${events.length + 1}`,
        now: () => 10,
      },
    })

    await adapter.getUser()

    const serialized = JSON.stringify(events)
    expect(serialized).toContain('fnf.transport.request')
    expect(serialized).toContain('/user')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('user-sensitive')
    expect(serialized).not.toContain('workspace-sensitive')
    expect(serialized).not.toContain('app-sensitive')
  })
})
