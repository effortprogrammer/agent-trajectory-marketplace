import type { MediaRef } from '../../types'
import { describe, expect, it } from 'vitest'
import { resolveMediaMeta } from '../../media-meta'
import { checkMedia, dimensionsWithin, durationsWithin } from '../media'

function ref(id: string, meta?: MediaRef['meta']): MediaRef {
  return { id, type: 'media_input', url: `https://cdn/${id}.png`, ...(meta ? { meta } : {}) }
}

const CFG = {
  field: 'medias',
  format: 'wrapped' as const,
  roles: ['image', 'start_image', 'video', 'audio'],
  rules: [
    dimensionsWithin(['image', 'start_image'], { minSide: 300, maxSide: 6000, ratio: [0.4, 2.5] }),
    dimensionsWithin(['video'], { minSide: 300, maxSide: 6000, minPixels: 409_600, ratio: [0.4, 2.5] }),
    durationsWithin(['video', 'audio'], { each: [2, 15], total: 15 }),
  ],
}

describe('dimensionsWithin', () => {
  it('flags too-small / too-large / off-ratio refs with human labels', () => {
    const issues = checkMedia(CFG, {
      image: [ref('ok', { width: 1024, height: 1024 }), ref('tiny', { width: 100, height: 400 })],
      start_image: [ref('wide', { width: 3000, height: 1000 })],
    })
    expect(issues.map(i => i.msg)).toEqual([
      'Image 2 is too small — the minimum dimension is 300px',
      'Start image aspect ratio must be between 0.4 and 2.5',
    ])
  })

  it('checks the pixel floor only where declared (videos, not images)', () => {
    // 500×500 = 250k pixels: fine as an image, below the 409.6k video floor
    expect(checkMedia(CFG, { image: [ref('a', { width: 500, height: 500 })] })).toEqual([])
    const issues = checkMedia(CFG, { video: [ref('v', { width: 500, height: 500 })] })
    expect(issues[0].msg).toContain('resolution is too low')
  })

  it('skips refs without meta — local knowledge is optional', () => {
    expect(checkMedia(CFG, { image: [ref('unknown')] })).toEqual([])
  })
})

describe('durationsWithin', () => {
  it('flags per-ref bounds and the combined budget', () => {
    const issues = checkMedia(CFG, {
      image: [ref('i', { width: 1024, height: 1024 })],
      video: [ref('v1', { width: 1024, height: 1024, durationSec: 1 }), ref('v2', { width: 1024, height: 1024, durationSec: 9 })],
      audio: [ref('a1', { durationSec: 8 })],
    })
    expect(issues.map(i => i.msg)).toEqual([
      'Video 1 must be between 2 and 15 seconds',
      'combined video + audio duration must be at most 15s, got 18s',
    ])
  })

  it('unknown durations do not trip the bounds or the budget', () => {
    expect(checkMedia(CFG, { video: [ref('v')], audio: [ref('a')] })).toEqual([])
  })
})

describe('resolveMediaMeta', () => {
  const resolver = async (r: MediaRef) => (r.id === 'fails' ? Promise.reject(new Error('boom')) : { width: 640, height: 640 })

  it('fills only refs missing meta, in a NEW input (no mutation)', async () => {
    const input = {
      model: 'demo',
      media: {
        image: [ref('a'), ref('b', { width: 1, height: 1 })],
        start_image: ref('single'), // non-array values stay non-array
      },
      settings: {},
    }
    const out = await resolveMediaMeta(input, resolver)

    expect(out).not.toBe(input)
    expect((out.media.image as MediaRef[])[0].meta).toEqual({ width: 640, height: 640 })
    expect((out.media.image as MediaRef[])[1].meta).toEqual({ width: 1, height: 1 }) // untouched
    expect((out.media.start_image as MediaRef).meta).toEqual({ width: 640, height: 640 })
    expect((input.media.image as MediaRef[])[0].meta).toBeUndefined() // original intact
  })

  it('a failing resolver leaves that ref as-is instead of failing the step', async () => {
    const out = await resolveMediaMeta({ media: { image: [ref('fails'), ref('ok')] } }, resolver)
    const [failed, ok] = out.media!.image as MediaRef[]
    expect(failed.meta).toBeUndefined()
    expect(ok.meta).toEqual({ width: 640, height: 640 })
  })

  it('passes through inputs without media', async () => {
    const input = { model: 'demo', settings: {}, media: undefined }
    expect(await resolveMediaMeta(input, resolver)).toBe(input)
  })
})

describe('integration: the seedance-2-0 declaration', () => {
  it('meta violations fail buildWireParams as one aggregated ValidationError', async () => {
    const { buildWireParams } = await import('../../spec')
    const { seedance2_0 } = await import('../../jobs/seedance-2-0')
    const input = {
      model: 'seedance_2_0',
      prompt: { instruction: 'x' },
      media: {
        start_image: [ref('frame', { width: 100, height: 100 })], // below 300px
        audio: [ref('a', { durationSec: 20 })], // above 15s
      },
      settings: { duration: 5 as const, aspectRatio: 'auto' as const },
    }
    expect(() => buildWireParams(input, seedance2_0)).toThrowError(/minimum dimension is 300px/)
    expect(() => buildWireParams(input, seedance2_0)).toThrowError(/between 2 and 15 seconds/)
  })

  it('meta never reaches the wire — the codec sends only id/type/url', async () => {
    const { buildWireParams } = await import('../../spec')
    const { seedance2_0 } = await import('../../jobs/seedance-2-0')
    const wire = buildWireParams({
      model: 'seedance_2_0',
      prompt: { instruction: 'a cube' },
      media: { start_image: [ref('frame', { width: 1024, height: 1024 })] },
      settings: { duration: 5 as const, aspectRatio: 'auto' as const },
    }, seedance2_0)
    const items = wire.medias as Array<{ role: string, data: Record<string, unknown> }>
    expect(items[0].data).toEqual({ id: 'frame', type: 'media_input', url: 'https://cdn/frame.png' })
  })
})

describe('createDomMediaMetaResolver outside a DOM', () => {
  it('resolves to undefined instead of throwing (safe to wire unconditionally)', async () => {
    const { createDomMediaMetaResolver } = await import('../../media/dom-meta-resolver')
    expect(await createDomMediaMetaResolver()(ref('x'))).toBeUndefined()
  })
})

describe('createDomMediaMetaResolver in a DOM', () => {
  /** Stub the structural DOM the resolver probes; `loads[n]` scripts attempt n. */
  function stubDom(loads: boolean[]) {
    const attempts = { count: 0 }
    class FakeImage {
      naturalWidth = 800
      naturalHeight = 600
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      #src = ''

      get src() {
        return this.#src
      }

      set src(value: string) {
        this.#src = value
        const ok = loads[Math.min(attempts.count++, loads.length - 1)]
        queueMicrotask(() => (ok ? this.onload?.() : this.onerror?.()))
      }
    }
    ;(globalThis as Record<string, unknown>).Image = FakeImage
    ;(globalThis as Record<string, unknown>).document = { createElement: () => ({}) }
    return {
      attempts,
      restore: () => {
        delete (globalThis as Record<string, unknown>).Image
        delete (globalThis as Record<string, unknown>).document
      },
    }
  }

  function imageRef(): MediaRef {
    return { id: 'frame', type: 'image', url: 'blob:frame' }
  }

  it('a failed measurement resolves undefined (the MediaMetaResolver contract), never rejects', async () => {
    const dom = stubDom([false])
    try {
      const { createDomMediaMetaResolver } = await import('../../media/dom-meta-resolver')
      expect(await createDomMediaMetaResolver()(imageRef())).toBeUndefined()
    }
    finally {
      dom.restore()
    }
  })

  it('failures are not cached — a retry of the same url re-measures', async () => {
    const dom = stubDom([false, true])
    try {
      const { createDomMediaMetaResolver } = await import('../../media/dom-meta-resolver')
      const resolve = createDomMediaMetaResolver()
      expect(await resolve(imageRef())).toBeUndefined()
      expect(await resolve(imageRef())).toEqual({ width: 800, height: 600 })
      expect(dom.attempts.count).toBe(2)
    }
    finally {
      dom.restore()
    }
  })

  it('successes ARE cached — one measurement per url', async () => {
    const dom = stubDom([true])
    try {
      const { createDomMediaMetaResolver } = await import('../../media/dom-meta-resolver')
      const resolve = createDomMediaMetaResolver()
      expect(await resolve(imageRef())).toEqual({ width: 800, height: 600 })
      expect(await resolve(imageRef())).toEqual({ width: 800, height: 600 })
      expect(dom.attempts.count).toBe(1)
    }
    finally {
      dom.restore()
    }
  })
})
