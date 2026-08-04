import type { Generation } from '../types'
import { describe, expect, it } from 'vitest'
import { seedance2_0 } from '../jobs/seedance-2-0'
import { getJobPhase, getMediaType, getPreviewUrl, getRawUrl, hasResult, isCompleted, isFailed, isFailedJobStatus, isFromJob, isGenerating, isTerminalJobStatus } from '../selectors'

function gen(overrides: Partial<Generation>): Generation {
  return { id: 'j1', model: 'demo', type: 'image', status: 'completed', input: { model: 'demo', settings: {} }, ...overrides }
}

describe('url selectors', () => {
  it('getRawUrl returns the full-quality url, getPreviewUrl prefers min → thumbnail → raw', () => {
    const full = gen({ results: { rawUrl: 'https://x/raw.png', minUrl: 'https://x/min.webp' } })
    expect(getRawUrl(full)).toBe('https://x/raw.png')
    expect(getPreviewUrl(full)).toBe('https://x/min.webp')

    const video = gen({ type: 'video', results: { rawUrl: 'https://x/o.mp4', thumbnailUrl: 'https://x/t.webp' } })
    expect(getPreviewUrl(video)).toBe('https://x/t.webp')

    expect(getPreviewUrl(gen({ results: { rawUrl: 'https://x/only.png' } }))).toBe('https://x/only.png')
    expect(getPreviewUrl(gen({}))).toBeUndefined()
  })
})

describe('status selectors', () => {
  it('buckets statuses into progress / failed / completed', () => {
    expect(getJobPhase('queued')).toBe('progress')
    expect(getJobPhase('in_progress')).toBe('progress')
    expect(getJobPhase('ip_detect')).toBe('progress')
    expect(getJobPhase('completed')).toBe('completed')
    for (const status of ['failed', 'nsfw', 'canceled', 'ip_detected'] as const)
      expect(getJobPhase(status)).toBe('failed')
    // unknown future statuses are still in flight, not failures
    expect(getJobPhase('warming_up' as never)).toBe('progress')
    expect(getJobPhase(gen({ status: 'failed' }))).toBe('failed')
  })

  it('isTerminalJobStatus / isFailedJobStatus', () => {
    expect(isTerminalJobStatus('completed')).toBe(true)
    expect(isTerminalJobStatus('nsfw')).toBe(true)
    expect(isTerminalJobStatus('queued')).toBe(false)
    expect(isFailedJobStatus('completed')).toBe(false)
    expect(isFailedJobStatus('canceled')).toBe(true)
  })
})

describe('predicates', () => {
  it('isCompleted / isFailed / isGenerating branch on the read model directly', () => {
    expect(isCompleted(gen({}))).toBe(true)
    expect(isFailed(gen({ status: 'nsfw' }))).toBe(true)
    expect(isGenerating(gen({ status: 'in_progress' }))).toBe(true)
    expect(isGenerating(gen({ status: 'failed' }))).toBe(false)
  })

  it('hasResult narrows results to non-optional', () => {
    const done = gen({ results: { rawUrl: 'https://x/o.png' } })
    expect(hasResult(done)).toBe(true)
    if (hasResult(done))
      expect(done.results.rawUrl).toBe('https://x/o.png') // no ?. needed — narrowed
    expect(hasResult(gen({}))).toBe(false)
  })

  it('isFromJob narrows input to the model typed shape', () => {
    const seedance = gen({ model: 'seedance_2_0' })
    expect(isFromJob(seedance, seedance2_0)).toBe(true)
    if (isFromJob(seedance, seedance2_0)) {
      // typed access: duration is the declared settings field, not unknown
      const duration: number | undefined = seedance.input.settings.duration
      expect(duration).toBeUndefined()
    }
    expect(isFromJob(gen({ model: 'demo' }), seedance2_0)).toBe(false)
  })
})

describe('getMediaType', () => {
  it('answers from a Generation, a MediaRef url, or a bare url; undefined otherwise', () => {
    expect(getMediaType(gen({ type: 'video' }))).toBe('video')
    expect(getMediaType('https://cdn/x/clip.MP4?sig=1')).toBe('video')
    expect(getMediaType('https://cdn/x/pic.webp#frag')).toBe('image')
    expect(getMediaType({ id: 'm1', type: 'media_input', url: 'https://cdn/a.heic' })).toBe('image')
    expect(getMediaType({ id: 'm1', type: 'media_input' })).toBeUndefined()
    expect(getMediaType('https://cdn/x/file.bin')).toBeUndefined()
    expect(getMediaType(undefined)).toBeUndefined()
  })
})
