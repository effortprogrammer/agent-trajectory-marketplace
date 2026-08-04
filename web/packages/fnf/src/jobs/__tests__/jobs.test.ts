import { describe, expect, it } from 'vitest'
import { buildWireParams, parseGeneration } from '../../spec'
import { nanoBanana2 } from '../nano-banana-2'
import { seedance2_0 } from '../seedance-2-0'

describe('nanoBanana2 (image, unwrapped input_images)', () => {
  it('builds wire params with bare image data array and canonical wire names', () => {
    const wire = buildWireParams(
      {
        model: 'nano_banana_2',
        prompt: { instruction: 'a blue cat' },
        media: { image: [{ id: 'u1', type: 'media_input', url: 'https://x/u1' }] },
        settings: { aspectRatio: '1:1', resolution: '2k', batchSize: 3 },
      },
      nanoBanana2,
    )
    expect(wire.prompt).toBe('a blue cat')
    // typed camelCase keys → backend's canonical snake_case wire keys (z.wire)
    expect(wire.aspect_ratio).toBe('1:1')
    expect(wire.batch_size).toBe(3)
    expect(wire).not.toHaveProperty('aspectRatio')
    expect(wire.resolution).toBe('2k')
    expect(wire.input_images).toEqual([{ id: 'u1', type: 'media_input', url: 'https://x/u1' }])
  })

  it('round-trips wire-named settings: parseGeneration maps aspect_ratio back to aspectRatio', () => {
    const gen = parseGeneration(
      { id: 'j1', status: 'completed', result_url: 'https://x/o.png', params: { prompt: 'cat', aspect_ratio: '1:1', resolution: '2k' } },
      nanoBanana2,
    )
    expect(gen.input.settings).toEqual({ aspectRatio: '1:1', resolution: '2k' })
    expect(gen.input.extra).toBeUndefined() // not misrouted to extra
    expect(buildWireParams(gen.input, nanoBanana2)).toMatchObject({ prompt: 'cat', aspect_ratio: '1:1', resolution: '2k' })
  })

  it('round-trips folder_id/parent_id and surfaces job_set_parent_id as parentJobSetId', () => {
    const gen = parseGeneration(
      {
        id: 'j2',
        job_set_id: 'set-2',
        job_set_parent_id: 'set-1',
        status: 'completed',
        result_url: 'https://x/o.png',
        params: { prompt: 'cat', aspect_ratio: '1:1', folder_id: 'f1', parent_id: 'set-1' },
      },
      nanoBanana2,
    )
    expect(gen.parentJobSetId).toBe('set-1')
    expect(gen.input.folderId).toBe('f1')
    expect(gen.input.parentId).toBe('set-1')
    expect(gen.input.extra).toBeUndefined() // targeting fields are not misrouted to extra
    expect(buildWireParams(gen.input, nanoBanana2)).toMatchObject({ folder_id: 'f1', parent_id: 'set-1' })
  })
})

describe('seedance2_0 (video, wrapped medias)', () => {
  it('passes settings through unchanged (no normalization) and wraps media with roles', () => {
    const wire = buildWireParams(
      {
        model: 'seedance_2_0',
        prompt: { instruction: 'demo' },
        media: { image: [{ id: 's1', type: 'image_job', url: 'https://x/s1' }] },
        settings: { duration: 8, aspectRatio: '16:9' },
      },
      seedance2_0,
    )
    expect(wire.duration).toBe(8) // not snapped — submit does not normalize; adjust() does
    expect(wire.aspect_ratio).toBe('16:9') // z.wire mapping
    expect(wire.generate_audio).toBe(true) // defaulted wire param
    expect(wire.medias).toEqual([{ role: 'image', data: { id: 's1', type: 'image_job', url: 'https://x/s1' } }])
  })

  it('enforces cardinality: a second start_image is rejected before any I/O', () => {
    const two = [{ id: 'a', type: 'media_input' }, { id: 'b', type: 'media_input' }]
    expect(() => buildWireParams(
      { model: 'seedance_2_0', media: { start_image: two }, settings: { duration: 8, aspectRatio: 'auto' } },
      seedance2_0,
    )).toThrow(/start_image.*at most 1.*got 2/)
  })

  it('enforces the cross-role rule: audio alone (no visuals) is rejected', () => {
    expect(() => buildWireParams(
      { model: 'seedance_2_0', media: { audio: { id: 'm', type: 'media_input' } }, settings: { duration: 8, aspectRatio: 'auto' } },
      seedance2_0,
    )).toThrow(/audio.*requires one of/)
  })

  it('validate hook: a frame with a forced concrete ratio is rejected (the live-failure trap)', () => {
    expect(() => buildWireParams(
      {
        model: 'seedance_2_0',
        prompt: { instruction: 'x' },
        media: { start_image: { id: 's', type: 'media_input' } },
        settings: { duration: 8, aspectRatio: '16:9' },
      },
      seedance2_0,
    )).toThrow(/aspectRatio must be 'auto'/)
  })

  it('validate hook: prompt is required when no media is attached (seedance + nano)', () => {
    expect(() => buildWireParams(
      { model: 'seedance_2_0', settings: { duration: 8, aspectRatio: 'auto' } },
      seedance2_0,
    )).toThrow(/Prompt is required/)
    expect(() => buildWireParams({ model: 'nano_banana_2', settings: { aspectRatio: 'auto' } }, nanoBanana2))
      .toThrow(/Prompt is required/)
  })

  it('validate hook: aggregates ALL issues at once', () => {
    try {
      buildWireParams(
        { model: 'seedance_2_0', media: { start_image: { id: 's', type: 'media_input' } }, settings: { duration: 8, aspectRatio: '16:9', batchSize: 9 } },
        seedance2_0,
      )
      throw new Error('should have thrown')
    }
    catch (err) {
      const issues = (err as { data?: { issues?: unknown[] } }).data?.issues ?? []
      expect(issues.length).toBeGreaterThanOrEqual(2) // ratio lock + batchSize range
    }
  })

  it('group cap: 10 reference images across image-like roles are rejected', () => {
    const refs = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, type: 'media_input' }))
    expect(() => buildWireParams(
      {
        model: 'seedance_2_0',
        prompt: { instruction: 'x' },
        media: { image: refs, start_image: { id: 's', type: 'media_input' } },
        settings: { duration: 8, aspectRatio: 'auto' },
      },
      seedance2_0,
    )).toThrow(/at most 9.*got 10/)
  })
})
