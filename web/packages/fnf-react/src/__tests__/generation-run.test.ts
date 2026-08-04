import type { Generation } from '@higgsfield/fnf/client'
import type { FnfObservationEvent } from '@higgsfield/fnf/observability'
import { createJobClient } from '@higgsfield/fnf/client'
import { ApiJobError } from '@higgsfield/fnf/errors'
import { defineJob, z } from '@higgsfield/fnf/jobs'
import { describe, expect, it } from 'vitest'
import { GenerationRun } from '../generation-run'
import { createMemoryBackend } from './test-utils'

const demo = defineJob({
  jobSetType: 'demo',
  outputType: 'image',
  params: { prompt: true, settings: { aspectRatio: z.aspectRatio(['1:1', '16:9']) } },
})

function statuses<I>(run: GenerationRun<I>) {
  const seen: string[] = []
  run.subscribe(() => {
    if (seen[seen.length - 1] !== run.status)
      seen.push(run.status)
  })
  return seen
}

describe('GenerationRun', () => {
  it('walks idle → submitting → generating → completed against the memory backend', async () => {
    const client = createJobClient({ adapter: createMemoryBackend(), jobs: [demo] })
    const run = new GenerationRun(client)
    const seen = statuses(run)

    const done = await run.start({ model: 'demo', prompt: { instruction: 'x' }, settings: { aspectRatio: '1:1' } })

    expect(run.status).toBe('completed')
    expect(done.length).toBeGreaterThan(0)
    expect(run.generations).toEqual(done)
    expect(seen).toEqual(['submitting', 'generating', 'completed'])
  })

  it('a failed submit becomes state, not a rejection', async () => {
    const client = createJobClient({ adapter: createMemoryBackend(), jobs: [demo] })
    const run = new GenerationRun(client)

    const done = await run.start({ model: 'unknown_model' } as never)

    expect(done).toEqual([])
    expect(run.status).toBe('failed')
    expect(run.error?.code).toBe('unknown_model')
  })

  it('a rejected confirmation becomes an aborted run, not an error', async () => {
    const run = new GenerationRun({
      submit: async () => { throw new ApiJobError('confirmation_rejected', 'Generation cancelled') },
      wait: async generations => generations,
    })

    const done = await run.start({} as never)

    expect(done).toEqual([])
    expect(run.status).toBe('aborted')
    expect(run.error).toBeUndefined()
  })

  it('abort mid-poll lands on status aborted (no error)', async () => {
    let release: (() => void) | undefined
    const pending: Generation = { id: 'g1', model: 'demo', type: 'image', status: 'queued', input: { model: 'demo', settings: {} } }
    const run = new GenerationRun({
      submit: async () => ({ generations: [pending] }),
      wait: (_gens, opts) => new Promise((_resolve, reject) => {
        // mimic the real client: abort surfaces as the typed JobAbortedError
        release = () => reject(new ApiJobError('aborted', 'Operation aborted'))
        opts?.signal?.addEventListener('abort', () => release?.())
      }),
    })

    const started = run.start({} as never)
    await Promise.resolve() // let submit settle
    await Promise.resolve()
    run.abort()
    await started

    expect(run.status).toBe('aborted')
    expect(run.error).toBeUndefined()
  })

  it('starting again supersedes the previous run (late results are dropped)', async () => {
    let resolveFirst: ((gens: Generation[]) => void) | undefined
    const first: Generation = { id: 'old', model: 'demo', type: 'image', status: 'queued', input: { model: 'demo', settings: {} } }
    const second: Generation = { id: 'new', model: 'demo', type: 'image', status: 'completed', input: { model: 'demo', settings: {} } }
    let calls = 0
    const run = new GenerationRun({
      submit: async () => ({ generations: calls++ === 0 ? [first] : [second] }),
      wait: async (gens) => {
        if (gens[0].id === 'old')
          return new Promise(resolve => (resolveFirst = resolve))
        return gens
      },
    })

    const firstStart = run.start({} as never)
    await Promise.resolve()
    await Promise.resolve()
    const secondStart = run.start({} as never)
    resolveFirst?.([{ ...first, status: 'completed' }]) // the superseded run settles late
    await Promise.all([firstStart, secondStart])

    expect(run.generations.map(g => g.id)).toEqual(['new']) // old run never touched state again
    expect(run.status).toBe('completed')
  })

  it('abort during the SUBMIT phase still lands on aborted (no stuck submitting)', async () => {
    let releaseSubmit: (() => void) | undefined
    const run = new GenerationRun({
      submit: () => new Promise((resolve) => {
        releaseSubmit = () => resolve({ generations: [] })
      }),
      wait: async gens => gens,
    })

    const started = run.start({} as never)
    run.abort() // mid-submit — before any generation exists
    releaseSubmit?.()
    await started

    expect(run.status).toBe('aborted')
    expect(run.isRunning).toBe(false) // a Generate button must un-brick
  })

  it('abort during submit keeps a handle on the generations the submit created', async () => {
    const created: Generation = { id: 'g1', model: 'demo', type: 'image', status: 'queued', input: { model: 'demo', settings: {} } }
    let releaseSubmit: (() => void) | undefined
    const run = new GenerationRun({
      submit: () => new Promise((resolve) => {
        releaseSubmit = () => resolve({ generations: [created], warning: 'partial' })
      }),
      wait: async gens => gens,
    })

    const started = run.start({} as never)
    run.abort()
    releaseSubmit?.() // the submit DID happen on the backend
    await started

    expect(run.status).toBe('aborted')
    // the UI can still render them and call client.cancel(id)
    expect(run.generations.map(g => g.id)).toEqual(['g1'])
    expect(run.warning).toBe('partial')
  })

  it('reset returns to idle and clears state', async () => {
    const client = createJobClient({ adapter: createMemoryBackend(), jobs: [demo] })
    const run = new GenerationRun(client)
    await run.start({ model: 'demo', prompt: { instruction: 'x' }, settings: { aspectRatio: '1:1' } })

    run.reset()

    expect(run.status).toBe('idle')
    expect(run.generations).toEqual([])
    expect(run.error).toBeUndefined()
  })

  it('emits safe observability events for lifecycle transitions', async () => {
    const events: FnfObservationEvent[] = []
    const client = createJobClient({ adapter: createMemoryBackend(), jobs: [demo] })
    const run = new GenerationRun(client, {
      observability: {
        observer: (event) => {
          events.push(event)
        },
      },
    })

    await run.start({ model: 'demo', prompt: { instruction: 'private prompt' }, settings: { aspectRatio: '1:1' } })
    run.reset()

    expect(events.map(event => event.name)).toEqual(expect.arrayContaining([
      'fnf.react.generation_run.start',
      'fnf.react.generation_run.submitted',
      'fnf.react.generation_run.progress',
      'fnf.react.generation_run.completed',
      'fnf.react.generation_run.reset',
    ]))
    expect(JSON.stringify(events)).not.toContain('private prompt')
  })
})
