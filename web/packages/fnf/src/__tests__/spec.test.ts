import { describe, expect, it } from 'vitest'
import { defineJob } from '../define-job'
import { buildWireParams, parseGeneration } from '../spec'
import { z } from '../z'

const job = defineJob({
  jobSetType: 'seedance_2_0',
  outputType: 'video',
  params: {
    prompt: true,
    media: { field: 'medias', format: 'wrapped', roles: ['start_image'] },
    settings: {
      duration: z.duration({ values: [5, 10] }),
      aspectRatio: z.aspectRatio(['1:1', '16:9']),
      resolution: z._default(z.enum(['720p', '1080p']), '720p'),
    },
  },
  finalize: wire => ({ ...wire, use_chain: true }),
})

describe('buildWireParams', () => {
  it('flattens prompt, media, settings (no normalization), finalize and extra', () => {
    const wire = buildWireParams(
      {
        model: 'seedance_2_0',
        prompt: { instruction: 'a cat', enhance: true },
        media: { start_image: [{ id: 'a', type: 'media_input', url: 'https://x/a' }] },
        settings: { duration: 7, aspectRatio: '1920:1081' },
        extra: { sample_shift: 0.3 },
      },
      job,
    )
    // settings pass through untouched — submit does not snap; `adjust()` does.
    expect(wire).toEqual({
      prompt: 'a cat',
      enhance_prompt: true,
      medias: [{ role: 'start_image', data: { id: 'a', type: 'media_input', url: 'https://x/a' } }],
      duration: 7,
      aspectRatio: '1920:1081',
      resolution: '720p',
      sample_shift: 0.3,
      use_chain: true,
    })
  })
})

describe('parseGeneration', () => {
  it('parses a job response into structured Generation, routing unknown keys to extra', () => {
    const gen = parseGeneration(
      {
        id: 'job-1',
        job_set_id: 'set-1',
        status: 'completed',
        result_url: 'https://x/out.mp4',
        params: {
          prompt: 'a cat',
          enhance_prompt: true,
          medias: [{ role: 'start_image', data: { id: 'a', type: 'media_input', url: 'https://x/a' } }],
          duration: 5,
          aspectRatio: '16:9',
          resolution: '720p',
          sample_shift: 0.3,
        },
      },
      job,
    )
    expect(gen.id).toBe('job-1')
    expect(gen.jobSetId).toBe('set-1')
    expect(gen.type).toBe('video')
    expect(gen.status).toBe('completed')
    expect(gen.input.prompt).toEqual({ instruction: 'a cat', enhance: true })
    expect(gen.input.settings).toEqual({ duration: 5, aspectRatio: '16:9', resolution: '720p' })
    expect(gen.input.extra).toEqual({ sample_shift: 0.3 })
    expect(gen.results?.rawUrl).toBe('https://x/out.mp4')
  })

  it('round-trips: buildWireParams(parseGeneration(job).input) reproduces params', () => {
    const params = {
      prompt: 'dog',
      enhance_prompt: false,
      medias: [{ role: 'start_image', data: { id: 'b', type: 'media_input', url: 'https://x/b' } }],
      duration: 10,
      aspectRatio: '1:1',
      resolution: '1080p',
      sample_shift: 0.5,
    }
    const gen = parseGeneration({ id: 'j', status: 'queued', params }, job)
    // finalize (use_chain) is deterministically injected on every submit; round-trip
    // losslessness covers prompt/media/settings/extra, plus the job's finalize fields.
    expect(buildWireParams(gen.input, job)).toEqual({ ...params, use_chain: true })
  })
})
