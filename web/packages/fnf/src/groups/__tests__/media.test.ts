import { describe, expect, it } from 'vitest'
import { atLeastOneOf, checkMedia, mediaCodec, requiresOneOf } from '../media'

const ref = (id: string, role: string) => ({ id, type: 'media_input', url: `https://x/${id}`, role })

describe('mediaCodec', () => {
  it('unwrapped: emits bare data array under the field', () => {
    const codec = mediaCodec({ field: 'input_images', format: 'unwrapped', roles: ['image'] })
    const wire = codec.serialize({ image: [ref('a', 'image'), ref('b', 'image')] })
    expect(wire).toEqual({ input_images: [{ id: 'a', type: 'media_input', url: 'https://x/a' }, { id: 'b', type: 'media_input', url: 'https://x/b' }] })
  })

  it('wrapped: emits {role,data} entries under the field', () => {
    const codec = mediaCodec({ field: 'medias', format: 'wrapped', roles: ['start_image', 'end_image'] })
    const wire = codec.serialize({ start_image: ref('a', 'start_image'), end_image: ref('b', 'end_image') })
    expect(wire).toEqual({
      medias: [
        { role: 'start_image', data: { id: 'a', type: 'media_input', url: 'https://x/a' } },
        { role: 'end_image', data: { id: 'b', type: 'media_input', url: 'https://x/b' } },
      ],
    })
  })

  it('single: emits one data object under the field', () => {
    const codec = mediaCodec({ field: 'input_image', format: 'single', roles: ['image'] })
    expect(codec.serialize({ image: ref('a', 'image') })).toEqual({
      input_image: { id: 'a', type: 'media_input', url: 'https://x/a' },
    })
  })

  it('emits nothing when no media is present', () => {
    const codec = mediaCodec({ field: 'input_images', format: 'unwrapped', roles: ['image'] })
    expect(codec.serialize({})).toEqual({})
  })

  it('wrapped round-trips role and id', () => {
    const codec = mediaCodec({ field: 'medias', format: 'wrapped', roles: ['start_image', 'end_image'] })
    const input = { start_image: [ref('a', 'start_image')], end_image: [ref('b', 'end_image')] }
    const parsed = codec.parse(codec.serialize(input))
    expect(parsed.start_image).toEqual([{ id: 'a', type: 'media_input', url: 'https://x/a', role: 'start_image' }])
    expect(parsed.end_image).toEqual([{ id: 'b', type: 'media_input', url: 'https://x/b', role: 'end_image' }])
  })

  it('single: rejects multiple refs instead of silently dropping all but the first', () => {
    const codec = mediaCodec({ field: 'input_image', format: 'single', roles: ['image'] })
    expect(() => codec.serialize({ image: [ref('a', 'image'), ref('b', 'image')] }))
      .toThrow(/exactly one ref, got 2/)
  })

  it('rejects an undeclared role instead of silently dropping it (typos, get-then-resubmit)', () => {
    const codec = mediaCodec({ field: 'medias', format: 'wrapped', roles: ['image'] })
    expect(() => codec.serialize({ style_ref: ref('a', 'style_ref') })).toThrow(/not declared by this job: style_ref/)
  })
})

describe('checkMedia (cardinality + cross-role rules)', () => {
  const cfg = {
    field: 'medias',
    format: 'wrapped' as const,
    roles: ['image', 'start_image', 'audio'],
    counts: { start_image: { min: 1, max: 1 }, image: { max: 2 } },
    rules: [requiresOneOf('audio', ['image'])],
  }

  it('passes a valid combination', () => {
    expect(checkMedia(cfg, { start_image: ref('s', 'start_image'), image: [ref('a', 'image')], audio: ref('m', 'audio') })).toEqual([])
  })

  it('reports min/max violations with pydantic-shaped issues', () => {
    const issues = checkMedia(cfg, { image: [ref('a', 'image'), ref('b', 'image'), ref('c', 'image')] })
    expect(issues).toEqual([
      { loc: ['media', 'start_image'], msg: expect.stringMatching(/at least 1.*got 0/) },
      { loc: ['media', 'image'], msg: expect.stringMatching(/at most 2.*got 3/) },
    ])
  })

  it('requiresOneOf fires only when the dependent role is present', () => {
    const rule = requiresOneOf('audio', ['image', 'video'])
    expect(rule({ audio: 0, image: 0, video: 0 }, {})).toBeNull() // no audio — nothing required
    expect(rule({ audio: 1, image: 0, video: 0 }, {})).toMatch(/requires one of: image, video/)
    expect(rule({ audio: 1, image: 1, video: 0 }, {})).toBeNull()
  })

  it('atLeastOneOf requires the group', () => {
    const rule = atLeastOneOf(['start_image', 'end_image'])
    expect(rule({ start_image: 0, end_image: 0 }, {})).toMatch(/at least one of/)
    expect(rule({ start_image: 1, end_image: 0 }, {})).toBeNull()
  })
})
