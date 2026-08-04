import { describe, expect, it } from 'vitest'
import { defineJob } from '../define-job'
import { buildRegistry } from '../registry'
import { z } from '../z'

const job = defineJob({
  jobSetType: 'demo_video',
  outputType: 'video',
  params: {
    media: { field: 'medias', format: 'wrapped', roles: ['start_image'] },
    settings: {
      seed: z.optional(z.number()),
      duration: z.duration({ values: [5, 10] }),
      aspectRatio: z.aspectRatio(['1:1', '16:9']),
      resolution: z._default(z.enum(['720p', '1080p']), '720p'),
    },
  },
  finalize: wire => ({ ...wire, use_chain: true }),
})

describe('defineJob', () => {
  it('keeps identity fields and media config', () => {
    expect(job.jobSetType).toBe('demo_video')
    expect(job.outputType).toBe('video')
    expect(job.media?.format).toBe('wrapped')
  })

  it('builds a settings schema that validates and applies defaults', () => {
    expect(job.settingsSchema.parse({ duration: 5, aspectRatio: '1:1' })).toEqual({
      duration: 5,
      aspectRatio: '1:1',
      resolution: '720p',
    })
  })

  it('collects normalizers for tagged settings fields only', () => {
    expect(job.normalizers).toEqual({
      duration: { kind: 'duration', values: [5, 10] },
      aspectRatio: { kind: 'aspectRatio', options: ['1:1', '16:9'] },
    })
  })

  it('exposes the finalize hook (last touch on the assembled wire body)', () => {
    expect(job.finalize?.({ existing: 1 }, { model: 'demo_video', settings: {} })).toEqual({ existing: 1, use_chain: true })
  })

  it('rejects single/unwrapped media with multiple roles', () => {
    expect(() => defineJob({
      jobSetType: 'bad',
      outputType: 'image',
      params: {
        media: { field: 'input_images', format: 'unwrapped', roles: ['image', 'audio'] },
        settings: {},
      },
    })).toThrow(/exactly one role/)
  })
})

describe('defineJob wire-collision guard', () => {
  it('rejects two settings mapping to one wire key', () => {
    expect(() => defineJob({
      jobSetType: 'clash',
      outputType: 'image',
      params: {
        settings: { a: z.wire('same_key', z.number()), b: z.wire('same_key', z.string()) },
      },
    })).toThrow(/both serialize to wire key 'same_key'/)
  })

  it('rejects a settings key shadowing a prompt/media wire key', () => {
    expect(() => defineJob({
      jobSetType: 'clash2',
      outputType: 'image',
      params: {
        prompt: true,
        settings: { prompt: z.string() }, // 'prompt' is the prompt group's wire key
      },
    })).toThrow(/collides with the prompt wire key/)
  })
})

describe('tagged schemas survive z.optional / z._default wrappers', () => {
  it('keeps the normalizer and wire name of a wrapped schema', () => {
    const wrapped = defineJob({
      jobSetType: 'wrapped',
      outputType: 'image',
      params: {
        settings: {
          aspectRatio: z.optional(z.wire('aspect_ratio', z.aspectRatio(['1:1', '16:9']))),
          duration: z._default(z.duration({ values: [5, 10] }), 5),
        },
      },
    })
    expect(wrapped.normalizers.aspectRatio).toEqual({ kind: 'aspectRatio', options: ['1:1', '16:9'] })
    expect(wrapped.normalizers.duration).toEqual({ kind: 'duration', values: [5, 10] })
    expect(wrapped.wireNames).toEqual({ aspectRatio: 'aspect_ratio' })
  })
})

describe('buildRegistry', () => {
  it('indexes jobs by jobSetType', () => {
    const registry = buildRegistry([job])
    expect(registry.get('demo_video')).toBe(job)
    expect(registry.get('missing')).toBeUndefined()
  })

  it('throws on a duplicate jobSetType instead of last-write-wins', () => {
    expect(() => buildRegistry([job, job])).toThrow(/duplicate jobSetType 'demo_video'/)
  })
})
