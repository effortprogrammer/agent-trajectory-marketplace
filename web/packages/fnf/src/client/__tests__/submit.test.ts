import type { GenerationBackend } from '../../backend'
import { describe, expect, it, vi } from 'vitest'
import { defineJob } from '../../define-job'
import { createJobClient } from '../index'

const demo = defineJob({
  jobSetType: 'demo',
  outputType: 'image',
  params: { settings: {} },
})

function backend(confirm?: GenerationBackend['confirm']): GenerationBackend {
  let id = 0
  return {
    createJobs: vi.fn(async () => [`job-${++id}`]),
    getJob: vi.fn(async jobId => ({ id: jobId, status: 'completed' })),
    listJobs: vi.fn(async () => ({ items: [] })),
    estimateCost: vi.fn(async () => ({ credits: 1 })),
    ...(confirm ? { confirm } : {}),
  }
}

describe('submit confirmation fan-out', () => {
  it('rejects confirmed count fan-out before opening approval or creating jobs', async () => {
    const confirm = vi.fn(async () => 'single-use-token')
    const adapter = backend(confirm)
    const client = createJobClient({ adapter, jobs: [demo] })

    await expect(client.submit({ model: 'demo', settings: {}, count: 2 })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('settings.batchSize'),
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(adapter.createJobs).not.toHaveBeenCalled()
  })

  it('preserves count fan-out for direct adapters without confirmation', async () => {
    const adapter = backend()
    const client = createJobClient({ adapter, jobs: [demo] })

    const result = await client.submit({ model: 'demo', settings: {}, count: 2 })

    expect(result.generations.map(generation => generation.id)).toEqual(['job-1', 'job-2'])
    expect(adapter.createJobs).toHaveBeenCalledTimes(2)
  })

  it('passes one confirmed request its opaque token unchanged', async () => {
    const confirm = vi.fn(async () => 'single-use-token')
    const adapter = backend(confirm)
    const client = createJobClient({ adapter, jobs: [demo] })

    await client.submit({ model: 'demo', settings: {} })

    expect(confirm).toHaveBeenCalledOnce()
    expect(adapter.createJobs).toHaveBeenCalledWith(expect.objectContaining({
      confirmationToken: 'single-use-token',
    }))
  })
})
