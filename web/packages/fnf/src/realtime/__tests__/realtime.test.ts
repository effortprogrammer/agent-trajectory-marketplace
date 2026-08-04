import type { ConfirmSubmit, RealtimeBackend } from '../../backend'
import type { RealtimeChainEditWireRequest, RealtimeImageRef } from '../types'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeClient } from '../client'
import {
  buildRealtimeChainEditRequest,
  parseRealtimeChainEditResult,
  parseRealtimeCustomStyle,
} from '../codec'

const MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const CHAIN_ID = '22222222-2222-4222-8222-222222222222'
const JOB_SET_ID = '33333333-3333-4333-8333-333333333333'
const JOB_ID = '44444444-4444-4444-8444-444444444444'
const STYLE_ID = '55555555-5555-4555-8555-555555555555'

const image: RealtimeImageRef = {
  id: MEDIA_ID,
  type: 'media_input',
  url: 'https://private.example/source.png',
  meta: { width: 1024, height: 1024 },
}

const editResponse = {
  chain_id: CHAIN_ID,
  job_set_id: JOB_SET_ID,
  job_id: JOB_ID,
  status: 'in_progress',
  created_at: 123.5,
}

function backend(overrides: Partial<RealtimeBackend> = {}): RealtimeBackend {
  return {
    editRealtimeChain: vi.fn(async () => editResponse),
    estimateRealtimeChainCost: vi.fn(async () => ({ credits: 1, credits_exact: 0.75 })),
    finalizeRealtimeChain: vi.fn(async req => ({ chain_id: req.chain_id, status: 'finalized' })),
    listRealtimeCustomStyles: vi.fn(async () => ({ items: [], next_cursor: null })),
    createRealtimeCustomStyle: vi.fn(async req => ({ id: STYLE_ID, prompt: req.prompt, reference: req.reference ?? null })),
    updateRealtimeCustomStyle: vi.fn(async (id, req) => ({ id, prompt: req.prompt ?? 'old', reference: req.reference ?? null })),
    deleteRealtimeCustomStyle: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('realtime Flux Klein edit chains', () => {
  it('maps camelCase input to the exact edit wire and strips MediaRef display metadata', () => {
    expect(buildRealtimeChainEditRequest({
      chainId: CHAIN_ID,
      params: {
        prompt: 'Make this cinematic',
        mode: 'basic',
        resolution: '2k',
        aspectRatio: '16:9',
        images: [image],
      },
    })).toEqual({
      chain_id: CHAIN_ID,
      params: {
        prompt: 'Make this cinematic',
        mode: 'basic',
        resolution: '2k',
        aspect_ratio: '16:9',
        medias: [{
          role: 'image',
          data: { id: image.id, type: image.type },
        }],
      },
    })
  })

  it('runs the shared confirmation contract against the exact wire body and forwards its token', async () => {
    const adapter = backend()
    const confirm: ConfirmSubmit = vi.fn(async () => 'approved-token')
    const client = createRealtimeClient({ adapter, confirm })
    const input = {
      params: {
        prompt: 'Turn it into a sketch',
        resolution: '1k' as const,
        aspectRatio: '1:1' as const,
        images: [image],
      },
    }
    const expected = buildRealtimeChainEditRequest(input)

    await expect(client.editChain(input)).resolves.toEqual({
      chainId: editResponse.chain_id,
      jobSetId: editResponse.job_set_id,
      jobId: editResponse.job_id,
      status: 'in_progress',
      createdAt: 123.5,
    })
    expect(confirm).toHaveBeenCalledWith({
      jobSetType: 'flux_klein_realtime',
      params: expected,
    })
    expect(adapter.editRealtimeChain).toHaveBeenCalledWith({
      ...expected,
      confirmation_token: 'approved-token',
    })
  })

  it('uses the adapter confirmation compatibility bridge when one is installed', async () => {
    const confirm: ConfirmSubmit = vi.fn(async () => 'adapter-token')
    const adapter = Object.assign(backend(), { confirm })
    const client = createRealtimeClient({ adapter })

    await client.editChain({
      params: {
        prompt: 'Edit once',
        resolution: '1k',
        aspectRatio: '1:1',
        images: [image],
      },
    })

    expect(confirm).toHaveBeenCalledOnce()
    expect(adapter.editRealtimeChain).toHaveBeenCalledWith(expect.objectContaining({ confirmation_token: 'adapter-token' }))
  })

  it('accepts an already-issued token without opening a second confirmation', async () => {
    const adapter = backend()
    const confirm: ConfirmSubmit = vi.fn(async () => 'unexpected-token')
    const client = createRealtimeClient({ adapter, confirm })

    await client.editChain({
      params: {
        prompt: 'Edit once',
        resolution: '1k',
        aspectRatio: '1:1',
        images: [image],
      },
    }, { confirmationToken: 'external-token' })

    expect(confirm).not.toHaveBeenCalled()
    expect(adapter.editRealtimeChain).toHaveBeenCalledWith(expect.objectContaining({ confirmation_token: 'external-token' }))
  })

  it('serializes structured controls and allows four explicit images with a saved style', () => {
    const request = buildRealtimeChainEditRequest({
      params: {
        settings: {
          style: 'custom',
          customStyle: 'editorial flash',
          mood: 'dramatic',
          palette: 'custom',
          customColors: ['#FF00AA'],
          sketchInfluence: 65,
          referenceMode: 'character',
          target: 'selection',
          customStyleId: STYLE_ID,
        },
        resolution: '2k',
        aspectRatio: '3:4',
        images: [image, image, image, image],
      },
    })

    expect(request.params).toMatchObject({
      mode: 'advanced',
      aspect_ratio: '3:4',
      settings: {
        custom_style: 'editorial flash',
        custom_colors: ['#FF00AA'],
        sketch_influence: 65,
        reference_mode: 'character',
        custom_style_id: STYLE_ID,
      },
    })
    expect(request.params.medias).toHaveLength(4)

    expect(() => buildRealtimeChainEditRequest({
      params: {
        settings: { style: 'custom', customStyleId: STYLE_ID },
        resolution: '1k',
        aspectRatio: '1:1',
        images: [image, image, image, image, image],
      },
    })).toThrow(expect.objectContaining({ code: 'validation' }))
  })

  it('polls the returned edit job through the internal read-only job entry', async () => {
    const getJob = vi.fn()
      .mockResolvedValueOnce({
        id: JOB_ID,
        job_set_id: JOB_SET_ID,
        job_set_type: 'flux_klein_edit',
        status: 'in_progress',
        params: { prompt: 'One edit' },
      })
      .mockResolvedValueOnce({
        id: JOB_ID,
        job_set_id: JOB_SET_ID,
        job_set_type: 'flux_klein_edit',
        status: 'completed',
        result_url: 'https://cdn.example/edit.png',
        params: { prompt: 'One edit' },
      })
    const adapter = Object.assign(backend(), { getJob })
    const client = createRealtimeClient({
      adapter,
      poll: { intervalMs: 0, timeoutMs: 1_000 },
      scheduler: { sleep: async () => {} },
    })

    const submitted = await client.editChain({
      params: {
        prompt: 'One edit',
        resolution: '1k',
        aspectRatio: '1:1',
        images: [image],
      },
    })
    await expect(client.pollEditJob(submitted.jobId)).resolves.toMatchObject({
      id: JOB_ID,
      jobSetId: JOB_SET_ID,
      model: 'flux_klein_edit',
      type: 'image',
      status: 'completed',
      results: { rawUrl: 'https://cdn.example/edit.png' },
    })
    expect(getJob).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['both prompt and settings', { prompt: 'x', settings: { style: 'custom' } }],
    ['neither prompt nor settings', {}],
    ['an oversized prompt', { prompt: 'x'.repeat(10_001) }],
  ])('rejects %s before sending', async (_label, instruction) => {
    const adapter = backend()
    const client = createRealtimeClient({ adapter })

    await expect(client.editChain({
      params: {
        ...instruction,
        resolution: '1k',
        aspectRatio: '1:1',
        images: [image],
      } as never,
    })).rejects.toMatchObject({ code: 'validation' })
    expect(adapter.editRealtimeChain).not.toHaveBeenCalled()
  })

  it('rejects non-canonical ids, non-image media types, and invalid response ids', async () => {
    const adapter = backend()
    const client = createRealtimeClient({ adapter })

    expect(() => buildRealtimeChainEditRequest({
      chainId: 'not-a-uuid',
      params: {
        prompt: 'Edit once',
        resolution: '1k',
        aspectRatio: '1:1',
        images: [{ ...image, id: 'https://cdn.example/source.png', type: 'video_input' as never }],
      },
    })).toThrow(expect.objectContaining({ code: 'validation' }))
    expect(() => parseRealtimeChainEditResult({ ...editResponse, job_id: 'not-a-uuid' }))
      .toThrow(expect.objectContaining({ code: 'validation' }))
    await expect(client.updateCustomStyle('not-a-uuid', {})).rejects.toMatchObject({ code: 'validation' })
    await expect(client.createCustomStyle({ reference: { mediaId: 'not-a-uuid' } }))
      .rejects.toMatchObject({ code: 'validation' })
    expect(adapter.updateRealtimeCustomStyle).not.toHaveBeenCalled()
    expect(adapter.createRealtimeCustomStyle).not.toHaveBeenCalled()
  })

  it('does not retry a failed edit because each attempt can reserve credits', async () => {
    const editRealtimeChain = vi.fn(async (_req: RealtimeChainEditWireRequest) => {
      throw new Error('connection dropped')
    })
    const client = createRealtimeClient({ adapter: backend({ editRealtimeChain }) })

    await expect(client.editChain({
      params: {
        prompt: 'One attempt only',
        resolution: '1k',
        aspectRatio: '1:1',
        images: [image],
      },
    })).rejects.toThrow('connection dropped')
    expect(editRealtimeChain).toHaveBeenCalledOnce()
  })
})

describe('realtime cost, finalize, and custom styles', () => {
  it('maps cost/finalize responses and uses the public chain id', async () => {
    const adapter = backend()
    const client = createRealtimeClient({ adapter })

    await expect(client.estimateChainCost({
      resolution: '2k',
      aspectRatio: '16:9',
    })).resolves.toEqual({ credits: 1, creditsExact: 0.75 })
    expect(adapter.estimateRealtimeChainCost).toHaveBeenCalledWith({
      mode: 'advanced',
      resolution: '2k',
      aspect_ratio: '16:9',
    })

    await expect(client.finalizeChain({ chainId: CHAIN_ID })).resolves.toEqual({
      chainId: CHAIN_ID,
      status: 'finalized',
    })
    expect(adapter.finalizeRealtimeChain).toHaveBeenCalledWith({ chain_id: CHAIN_ID })
  })

  it('maps saved custom styles and every CRUD request without leaking snake_case', async () => {
    const styleWire = {
      id: STYLE_ID,
      prompt: 'soft flash',
      reference: {
        media_id: image.id,
        url: 'https://cdn.example/style.png',
        source_name: 'style.png',
        content_type: 'image/png',
      },
    }
    expect(parseRealtimeCustomStyle(styleWire)).toEqual({
      id: STYLE_ID,
      prompt: 'soft flash',
      reference: {
        mediaId: image.id,
        url: 'https://cdn.example/style.png',
        sourceName: 'style.png',
        contentType: 'image/png',
      },
    })

    const adapter = backend({
      listRealtimeCustomStyles: vi.fn(async () => ({ items: [styleWire], next_cursor: 123.5 })),
      createRealtimeCustomStyle: vi.fn(async () => styleWire),
      updateRealtimeCustomStyle: vi.fn(async () => ({ ...styleWire, prompt: 'new prompt', reference: null })),
    })
    const client = createRealtimeClient({ adapter })

    await expect(client.listCustomStyles({ cursor: 123, size: 20 })).resolves.toEqual({
      items: [parseRealtimeCustomStyle(styleWire)],
      nextCursor: 123.5,
    })
    expect(adapter.listRealtimeCustomStyles).toHaveBeenCalledWith({ cursor: 123, size: 20 })

    await client.createCustomStyle({
      prompt: 'soft flash',
      reference: {
        mediaId: image.id,
        url: 'https://cdn.example/style.png',
        sourceName: 'style.png',
        contentType: 'image/png',
      },
    })
    expect(adapter.createRealtimeCustomStyle).toHaveBeenCalledWith({
      prompt: 'soft flash',
      reference: {
        media_id: image.id,
        url: 'https://cdn.example/style.png',
        source_name: 'style.png',
        content_type: 'image/png',
      },
    })

    await expect(client.updateCustomStyle(STYLE_ID, {
      prompt: 'new prompt',
      clearReference: true,
    })).resolves.toMatchObject({ prompt: 'new prompt', reference: null })
    expect(adapter.updateRealtimeCustomStyle).toHaveBeenCalledWith(STYLE_ID, {
      prompt: 'new prompt',
      clear_reference: true,
    })

    await expect(client.deleteCustomStyle(STYLE_ID)).resolves.toBeUndefined()
    expect(adapter.deleteRealtimeCustomStyle).toHaveBeenCalledWith(STYLE_ID)
  })

  it('validates custom-style pagination and reference metadata before requests', async () => {
    const adapter = backend()
    const client = createRealtimeClient({ adapter })

    await expect(client.listCustomStyles({ cursor: Number.NaN })).rejects.toMatchObject({ code: 'validation' })
    await expect(client.createCustomStyle({
      reference: { mediaId: image.id, url: 'file:///private/image.png' },
    })).rejects.toMatchObject({ code: 'validation' })
    expect(adapter.listRealtimeCustomStyles).not.toHaveBeenCalled()
    expect(adapter.createRealtimeCustomStyle).not.toHaveBeenCalled()
  })
})
