import type { GenerationBackend, MediaBackend, ProfileBackend } from '../../backend'
import type { BinaryUploader } from '../../media'
import type { FnfObservationEvent } from '../index'
import { describe, expect, it, vi } from 'vitest'
import { createJobClient } from '../../client'
import { defineJob } from '../../define-job'
import { ApiJobError } from '../../errors'
import { createMediaClient } from '../../media'
import { createProfileClient } from '../../profile'
import { z } from '../../z'
import { composeObservers, createNoopObserver, withObservedGenerationBackend, withObservedTransport, withObservedUploader } from '../index'

const demo = defineJob({
  jobSetType: 'demo',
  outputType: 'image',
  params: { prompt: true, settings: { aspectRatio: z.aspectRatio(['1:1']) } },
})

// Inline port stubs — this suite tests the observability layer, which must not
// depend on concrete adapters (those live in @higgsfield/fnf-adapters).
function stubBackend(cost = 1): GenerationBackend {
  return {
    createJobs: async ({ jobSetType }) => [{ id: 'job-1', job_set_type: jobSetType, status: 'completed', result_url: 'memory://out' }],
    getJob: async id => ({ id, status: 'completed' }),
    listJobs: async () => ({ items: [] }),
    estimateCost: async () => ({ credits: cost }),
  }
}

function recorder() {
  const events: FnfObservationEvent[] = []
  return {
    events,
    observer: (event: FnfObservationEvent) => {
      events.push(event)
    },
  }
}

describe('fnf observability', () => {
  it('emits job lifecycle spans without changing client behavior', async () => {
    const rec = recorder()
    const client = createJobClient({
      adapter: stubBackend(7),
      jobs: [demo],
      observability: { observer: rec.observer, traceId: 'trace-1' },
    })

    const submitted = await client.submit({ model: 'demo', prompt: { instruction: 'secret prompt' }, settings: { aspectRatio: '1:1' } })
    await client.cost({ model: 'demo', prompt: { instruction: 'secret prompt' }, settings: { aspectRatio: '1:1' } })

    expect(submitted.generations).toHaveLength(1)
    expect(rec.events.map(e => `${e.name}:${e.phase}`)).toContain('fnf.job.submit:start')
    expect(rec.events.map(e => `${e.name}:${e.phase}`)).toContain('fnf.job.submit:success')
    expect(rec.events.find(e => e.name === 'fnf.job.submit' && e.phase === 'success')?.attributes).toMatchObject({ generation_count: 1 })
    expect(JSON.stringify(rec.events)).not.toContain('secret prompt')
  })

  it('emits typed error metadata for SDK failures', async () => {
    const rec = recorder()
    const client = createJobClient({
      adapter: stubBackend(),
      jobs: [demo],
      observability: { observer: rec.observer },
    })

    await expect(client.submit({ model: 'missing_model' } as never)).rejects.toBeInstanceOf(ApiJobError)

    const error = rec.events.find(e => e.name === 'fnf.job.submit' && e.phase === 'error')
    expect(error?.error).toMatchObject({ code: 'unknown_model' })
  })

  it('observes transport requests with sanitized paths and safe status metadata', async () => {
    const rec = recorder()
    const transport = withObservedTransport(
      async () => ({ status: 201, body: { ok: true } }),
      { observer: rec.observer },
    )

    await transport({ method: 'POST', path: '/jobs/topaz-image?dry_run=true&token=secret', body: { prompt: 'secret' } })

    const success = rec.events.find(e => e.name === 'fnf.transport.request' && e.phase === 'success')
    expect(success?.attributes).toMatchObject({ method: 'POST', path: '/jobs/topaz-image?dry_run&token', status: 201 })
    expect(JSON.stringify(rec.events)).not.toContain('secret')
  })

  it('media upload spans do not expose upload URLs, filenames, bytes, or result URLs', async () => {
    const rec = recorder()
    const mediaBackend: MediaBackend = {
      getMedia: async () => ({}),
      listMedia: async () => ({ items: [] }),
      getUploadUrl: async () => ({ id: 'm1', url: 'https://cdn/private.png', upload_url: 'https://s3/private-put' }),
      confirmMedia: async () => ({ id: 'm1', status: 'uploaded', url: 'https://cdn/private.png' }),
    }
    const media = createMediaClient({
      mediaAdapter: mediaBackend,
      blobUploader: { transfer: async () => {} },
      observability: { observer: rec.observer },
    })

    await media.upload({ source: new Uint8Array([1, 2, 3]), filename: 'private-cat.png', role: 'image' })

    const text = JSON.stringify(rec.events)
    expect(rec.events.map(e => e.name)).toEqual(expect.arrayContaining(['fnf.media.upload', 'fnf.media.presign', 'fnf.media.transfer', 'fnf.media.confirm']))
    expect(text).not.toContain('private-cat.png')
    expect(text).not.toContain('https://s3/private-put')
    expect(text).not.toContain('https://cdn/private.png')
    expect(text).not.toContain('[1,2,3]')
  })

  it('profile spans expose only coarse metadata and ids', async () => {
    const rec = recorder()
    const workspaces = [{ id: 'w1', name: 'Secret Team', type: 'private', user_role: 'owner' }]
    const profileBackend: ProfileBackend = {
      getUser: async () => ({ id: 'u1', email: 'private@example.com', workspace_id: 'w1' }),
      listWorkspaces: async () => workspaces,
      getCurrentWorkspace: async () => workspaces[0],
      getWorkspaceWallet: async () => ({ subscription_balance: 0 }),
      switchWorkspace: async () => ({}),
    }
    const profile = createProfileClient({
      profileAdapter: profileBackend,
      observability: { observer: rec.observer },
    })

    await profile.getSnapshot()

    const snapshot = rec.events.find(e => e.name === 'fnf.profile.get_snapshot' && e.phase === 'success')
    expect(snapshot?.attributes).toMatchObject({ has_user: true, workspace_count: 1, has_current_workspace: true })
    expect(JSON.stringify(rec.events)).not.toContain('private@example.com')
    expect(JSON.stringify(rec.events)).not.toContain('Secret Team')
  })

  it('wrappers preserve behavior and observer failures do not affect operations', async () => {
    const observer = vi.fn(() => {
      throw new Error('observer exploded')
    })
    const onObserverError = vi.fn()
    const backend = withObservedGenerationBackend(stubBackend(), { observer, onObserverError })
    const client = createJobClient({ adapter: backend, jobs: [demo] })

    await expect(client.submit({ model: 'demo', prompt: { instruction: 'x' }, settings: { aspectRatio: '1:1' } })).resolves.toHaveProperty('generations')
    expect(onObserverError).toHaveBeenCalled()
  })

  it('compose/noop observers and uploader wrappers are safe defaults', async () => {
    const rec = recorder()
    const observer = composeObservers(createNoopObserver(), rec.observer)
    const uploader: BinaryUploader = withObservedUploader({
      transfer: async () => {},
      fetchBytes: async () => ({ bytes: new Uint8Array([1]), contentType: 'image/png' }),
    }, { observer })

    await uploader.transfer({ uploadUrl: 'https://s3/private', bytes: new Uint8Array([1]), contentType: 'image/png' })
    await uploader.fetchBytes?.('https://cdn/private.png')

    expect(rec.events.map(e => e.name)).toEqual(['fnf.media.transfer', 'fnf.media.transfer', 'fnf.media.fetch_bytes', 'fnf.media.fetch_bytes'])
    expect(JSON.stringify(rec.events)).not.toContain('https://s3/private')
    expect(JSON.stringify(rec.events)).not.toContain('https://cdn/private.png')
  })

  it('withObservedTransport preserves error behavior', async () => {
    const rec = recorder()
    const transport = withObservedTransport(async () => {
      throw new ApiJobError('network', 'offline')
    }, { observer: rec.observer })

    await expect(transport({ method: 'GET', path: '/health' })).rejects.toMatchObject({ code: 'network' })
    expect(rec.events.find(e => e.phase === 'error')?.error).toMatchObject({ code: 'network' })
  })
})
