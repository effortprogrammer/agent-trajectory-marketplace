import type { MediaRef } from '../../types'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors'
import { buildWireParams, parseGeneration } from '../../spec'
import { lookupSize } from '../dimensions'
import { KLING_DEFAULT_MOTION_ID, klingVideo } from '../kling'
import { nanoBanana2 } from '../nano-banana-2'
import { seedance2_0 } from '../seedance-2-0'
import { DEFAULT_SOUL_STYLE_ID, textToImageSoul } from '../text2image-soul'

function ref(id: string, meta?: MediaRef['meta']): MediaRef {
  return { id, type: 'media_input', url: `https://cdn/${id}.png`, ...(meta ? { meta } : {}) }
}

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
    return []
  }
  catch (err) {
    const issues = (err as { data?: { issues?: Array<{ msg: string }> } }).data?.issues ?? []
    return issues.map(i => i.msg)
  }
}

// ── restore: lossy finalize hooks round-trip (the get-then-resubmit contract) ──

describe('seedance restore round-trip', () => {
  it('a fast generation resubmits as fast (mode restored from wire model)', () => {
    const input = {
      model: 'seedance_2_0',
      prompt: { instruction: 'a cube' },
      settings: { duration: 8 as const, aspectRatio: '16:9' as const, mode: 'fast' as const },
    }
    const wire = buildWireParams(input, seedance2_0)
    expect(wire.model).toBe('seedance_2_0_fast')
    expect(wire.resolution).toBe('720p') // fast product default

    const gen = parseGeneration({ id: 'j1', status: 'completed', result_url: 'https://x/v.mp4', params: wire }, seedance2_0)
    expect(gen.input.settings.mode).toBe('fast')

    const rewire = buildWireParams(gen.input, seedance2_0)
    expect(rewire.model).toBe('seedance_2_0_fast') // NOT the 'std' schema default
    expect(rewire.width).toBe(wire.width)
    expect(rewire.height).toBe(wire.height)
  })

  it('a frame-led auto generation resubmits wire-identically and passes validate', () => {
    const input = {
      model: 'seedance_2_0',
      prompt: { instruction: 'animate' },
      media: { start_image: [ref('f', { width: 720, height: 1280 })] },
      settings: { duration: 5 as const, aspectRatio: 'auto' as const },
    }
    const wire = buildWireParams(input, seedance2_0)
    // product behavior: auto + measured portrait frame → concrete 9:16 + table dims
    expect(wire.aspect_ratio).toBe('9:16')
    expect(wire.resolution).toBe('1080p') // std product default
    expect([wire.width, wire.height]).toEqual([1080, 1920])

    const gen = parseGeneration({ id: 'j2', status: 'completed', result_url: 'https://x/v.mp4', params: wire }, seedance2_0)
    // frames lock the INPUT ratio to 'auto' — restore maps the resolved
    // concrete ratio back so the parsed input passes the same validate
    expect(gen.input.settings.aspectRatio).toBe('auto')

    const rewire = buildWireParams(gen.input, seedance2_0) // must not throw the ratio lock
    // 'auto' re-resolves from the round-tripped dims (the parsed refs have no
    // meta), so the resubmitted wire is product-shaped and identical
    expect(rewire.aspect_ratio).toBe('9:16')
    expect([rewire.width, rewire.height]).toEqual([1080, 1920])
  })

  it('changing resolution on a parsed input re-derives dims instead of resubmitting stale ones', () => {
    const wire = buildWireParams({
      model: 'seedance_2_0',
      prompt: { instruction: 'animate' },
      media: { start_image: [ref('f', { width: 720, height: 1280 })] },
      settings: { duration: 5 as const, aspectRatio: 'auto' as const },
    }, seedance2_0)
    const gen = parseGeneration({ id: 'j3', status: 'completed', result_url: 'https://x/v.mp4', params: wire }, seedance2_0)

    const rewire = buildWireParams({
      ...gen.input,
      settings: { ...gen.input.settings, resolution: '480p' },
    } as never, seedance2_0)
    expect(rewire.resolution).toBe('480p')
    expect([rewire.width, rewire.height]).toEqual([480, 854]) // fresh table lookup, not 1080×1920
  })
})

describe('kling restore round-trip', () => {
  const portrait = {
    model: 'kling',
    prompt: { instruction: 'pan up' },
    media: { input_image: ref('start', { width: 720, height: 1280 }) },
    settings: { duration: 5 as const, aspectRatio: '9:16' },
  }

  it('wire dims come from the start image; the backend-enum ratio rides along', () => {
    const wire = buildWireParams(portrait, klingVideo)
    expect([wire.width, wire.height]).toEqual([720, 1280])
    expect(wire.aspect_ratio).toBe('9:16') // in the backend enum (16:9|9:16|1:1) → kept
  })

  it('off-enum ratios are dropped from the wire (the backend accepts only 16:9|9:16|1:1)', () => {
    const wire = buildWireParams(
      { ...portrait, settings: { duration: 5 as const, aspectRatio: '4:3' } },
      klingVideo,
    )
    expect(wire).not.toHaveProperty('aspect_ratio')
  })

  it('a 9:16 generation resubmits as 9:16 (no silent 16:9 flip)', () => {
    const wire = buildWireParams(portrait, klingVideo)
    const gen = parseGeneration({ id: 'k1', status: 'completed', result_url: 'https://x/v.mp4', params: wire }, klingVideo)
    expect(gen.input.settings.aspectRatio).toBe('9:16') // restored via simplifyRatio

    const rewire = buildWireParams(gen.input, klingVideo)
    expect([rewire.width, rewire.height]).toEqual([720, 1280])
    expect(rewire.model).toBe(wire.model)
  })
})

// ── kling product rules ──

describe('kling product parity', () => {
  const base = {
    model: 'kling',
    media: { input_image: ref('start') },
  }

  it('enhance_prompt defaults to true and respects the default-preset sentinel', () => {
    // sentinel motion_id (the default) → the caller's choice, defaulting true
    const wire = buildWireParams({ ...base, settings: { duration: 5 as const } }, klingVideo)
    expect(wire.motion_id).toBe(KLING_DEFAULT_MOTION_ID)
    expect(wire.enhance_prompt).toBe(true)

    const declined = buildWireParams(
      { ...base, prompt: { enhance: false }, settings: { duration: 5 as const } },
      klingVideo,
    )
    expect(declined.enhance_prompt).toBe(false) // sentinel = "no preset" → user choice respected

    const preset = buildWireParams(
      { ...base, prompt: { enhance: false }, settings: { duration: 5 as const, motionId: 'real-preset-uuid' } },
      klingVideo,
    )
    expect(preset.enhance_prompt).toBe(true) // a real preset forces it on
  })

  it('always wires a prompt string and never the dead seed/cfg_scale knobs', () => {
    const wire = buildWireParams({ ...base, settings: { duration: 5 as const } }, klingVideo)
    expect(wire.prompt).toBe('') // the product always sends a string ('' when promptless)
    expect(wire).not.toHaveProperty('seed') // backend KlingParamsSchema drops it silently
    expect(wire).not.toHaveProperty('cfg_scale')
  })

  it('text-only kling works only at v2-5-turbo + 1080p (the one combination the backend allows)', () => {
    const wire = buildWireParams(
      { model: 'kling', prompt: { instruction: 'a storm rolls in' }, settings: { duration: 5 as const, resolution: '1080p' as const, aspectRatio: '9:16' } },
      klingVideo,
    )
    expect([wire.width, wire.height]).toEqual([720, 1280]) // box-derived dims
    expect(wire.mode).toBe('pro')

    // default resolution (720p → std) requires a start frame server-side
    expect(issuesOf(() => buildWireParams(
      { model: 'kling', prompt: { instruction: 'a storm rolls in' }, settings: { duration: 5 as const } },
      klingVideo,
    ))).toContain('input image is required for this model and mode')
  })

  it('legacy params with motion_id null coalesce to the sentinel and respect a stored enhance_prompt: false', () => {
    // shape stored by the previous SDK (motionId defaulted to null)
    const legacy = {
      model: 'kling-v2-5-turbo',
      prompt: 'pan',
      input_image: { id: 'start', type: 'media_input', url: 'https://cdn/start.png' },
      enhance_prompt: false,
      motion_id: null,
      cfg_scale: 0.5,
      resolution: '720p',
      duration: 5,
      seed: 7,
      use_unlim: false,
      width: 720,
      height: 1280,
      mode: 'std',
    }
    const gen = parseGeneration({ id: 'k-old', status: 'completed', result_url: 'https://x/v.mp4', params: legacy }, klingVideo)
    const rewire = buildWireParams(gen.input, klingVideo)
    expect(rewire.motion_id).toBe(KLING_DEFAULT_MOTION_ID) // product wire never carries null
    expect(rewire.enhance_prompt).toBe(false) // NOT force-flipped to true
  })

  it('rejects out-of-set durations with a typed issue (VideoKlingDuration is 5 | 10)', () => {
    expect(issuesOf(() => buildWireParams(
      { ...base, settings: { duration: 7 as unknown as 5 } },
      klingVideo,
    ))).toContain('duration must be one of: 5, 10')
  })
})

// ── auto-ratio resolution from measured media (product parity) ──

describe('auto aspect ratio resolves from the first image like the product', () => {
  it('nano: auto + landscape image meta → 16:9 with table dims (not 3:4)', () => {
    const wire = buildWireParams(
      {
        model: 'nano_banana_2',
        prompt: { instruction: 'restyle this' },
        media: { image: [ref('i', { width: 1920, height: 1080 })] },
        settings: { aspectRatio: 'auto' as const },
      },
      nanoBanana2,
    )
    expect(wire.aspect_ratio).toBe('16:9')
    expect([wire.width, wire.height]).toEqual([1376, 768])
  })

  it('nano: auto without local size knowledge falls back to 3:4', () => {
    const wire = buildWireParams(
      { model: 'nano_banana_2', prompt: { instruction: 'a cat' }, settings: { aspectRatio: 'auto' as const } },
      nanoBanana2,
    )
    expect(wire.aspect_ratio).toBe('3:4')
    expect([wire.width, wire.height]).toEqual([896, 1200])
  })

  it('seedance: auto without meta keeps auto on the wire with the 16:9 dims', () => {
    const wire = buildWireParams(
      {
        model: 'seedance_2_0',
        prompt: { instruction: 'x' },
        media: { image: [ref('i')] },
        settings: { duration: 5 as const, aspectRatio: 'auto' as const },
      },
      seedance2_0,
    )
    expect(wire.aspect_ratio).toBe('auto')
    expect([wire.width, wire.height]).toEqual([1920, 1080])
  })
})

// ── validation gaps closed (typed issues, not TypeErrors / backend 422s) ──

describe('seedance validate', () => {
  const withPrompt = (settings: Record<string, unknown>) => () => buildWireParams(
    { model: 'seedance_2_0', prompt: { instruction: 'x' }, settings: settings as never },
    seedance2_0,
  )

  it('enforces duration 4–15 (built.ts hard reject)', () => {
    expect(issuesOf(withPrompt({ duration: 30, aspectRatio: 'auto' }))).toContain('duration must be between 4 and 15')
  })

  it('rejects out-of-enum ratios with a typed issue instead of a TypeError', () => {
    expect(issuesOf(withPrompt({ duration: 8, aspectRatio: '2:1' }))[0]).toMatch(/aspectRatio must be one of/)
  })

  it('rejects fast + 1080p (the product fast config never offers it)', () => {
    expect(issuesOf(withPrompt({ duration: 8, aspectRatio: 'auto', mode: 'fast', resolution: '1080p' })))
      .toContain('resolution \'1080p\' is not available in fast mode')
  })

  it('defaults resolution per mode: std → 1080p, fast → 720p', () => {
    const std = buildWireParams({ model: 'seedance_2_0', prompt: { instruction: 'x' }, settings: { duration: 8 as const, aspectRatio: '16:9' as const } }, seedance2_0)
    expect(std.resolution).toBe('1080p')
    expect([std.width, std.height]).toEqual([1920, 1080])
    const fast = buildWireParams({ model: 'seedance_2_0', prompt: { instruction: 'x' }, settings: { duration: 8 as const, aspectRatio: '16:9' as const, mode: 'fast' as const } }, seedance2_0)
    expect(fast.resolution).toBe('720p')
    expect([fast.width, fast.height]).toEqual([1280, 720])
  })
})

describe('nano validate', () => {
  it('caps input images at 14 (NANO_BANANA_2_IMAGE_UPLOAD_LIMIT)', () => {
    const refs = Array.from({ length: 15 }, (_, i) => ref(`r${i}`))
    expect(() => buildWireParams(
      { model: 'nano_banana_2', prompt: { instruction: 'x' }, media: { image: refs }, settings: { aspectRatio: '1:1' as const } },
      nanoBanana2,
    )).toThrow(/image.*at most 14.*got 15/)
  })

  it('flags images under the 128px product minimum when meta is known', () => {
    expect(() => buildWireParams(
      { model: 'nano_banana_2', prompt: { instruction: 'x' }, media: { image: [ref('tiny', { width: 64, height: 64 })] }, settings: { aspectRatio: '1:1' as const } },
      nanoBanana2,
    )).toThrow(/minimum dimension is 128px/)
  })

  it('rejects on RAW prompt length >= 15000 (validatePrompt parity)', () => {
    const padded = `${'x'.repeat(14_000)}${' '.repeat(1_000)}` // trimmed 14k, raw 15k
    expect(() => buildWireParams(
      { model: 'nano_banana_2', prompt: { instruction: padded }, settings: { aspectRatio: '1:1' as const } },
      nanoBanana2,
    )).toThrow(/too long/)
  })
})

// ── soul product parity ──

describe('soul product parity', () => {
  const minimal = { model: 'text2image_soul', prompt: { instruction: 'portrait' }, settings: {} }

  it('default submit matches the /ai/image strategy: style, steps 50, sampler fields, portrait table dims', () => {
    const wire = buildWireParams(minimal, textToImageSoul)
    expect(wire.style_id).toBe(DEFAULT_SOUL_STYLE_ID) // never null/null
    expect(wire.steps).toBe(50)
    expect(wire.sample_shift).toBe(4) // 1080p default
    expect(wire.sample_guide_scale).toBe(4)
    expect(wire.negative_prompt).toBe('')
    expect(wire.enhance_prompt).toBe(true)
    expect(wire.aspect_ratio).toBe('3:4') // the product soul form defaults to PORTRAIT
    expect([wire.width, wire.height]).toEqual([1536, 2048]) // SOUL_RESOLUTION_MAP 1080p 3:4
    expect(wire.seed).toBeGreaterThanOrEqual(1)
    expect(wire.seed).toBeLessThanOrEqual(1_000_000)
  })

  it('snaps an off-table ratio to the closest table key instead of the portrait fallback', () => {
    const wire = buildWireParams({ ...minimal, settings: { aspectRatio: '1920:1080' } }, textToImageSoul)
    expect(wire.aspect_ratio).toBe('16:9') // a landscape request stays landscape
    expect([wire.width, wire.height]).toEqual([2048, 1152])
  })

  it('720p quality switches the table row and sample_shift', () => {
    const wire = buildWireParams({ ...minimal, settings: { quality: '720p' as const, aspectRatio: '16:9' } }, textToImageSoul)
    expect(wire.sample_shift).toBe(3)
    expect([wire.width, wire.height]).toEqual([1696, 960])
  })

  it('explicit styleId: null fails locally with a typed issue (dev backend 422 parity)', () => {
    expect(issuesOf(() => buildWireParams({ ...minimal, settings: { styleId: null } }, textToImageSoul)))
      .toContain('styleId is required (or send fashion_factory_id via extra)')
  })

  it('an image reference forces enhance_prompt off; a non-default style forces it on', () => {
    const referenced = buildWireParams(
      { ...minimal, media: { image_reference: ref('r') } },
      textToImageSoul,
    )
    expect(referenced.enhance_prompt).toBe(false)
    const styled = buildWireParams({ ...minimal, prompt: { instruction: 'x', enhance: false }, settings: { styleId: 'custom-style' } }, textToImageSoul)
    expect(styled.enhance_prompt).toBe(true)
  })
})

describe('lookupSize', () => {
  it('throws the typed ValidationError on unknown keys, not a TypeError', () => {
    const map = { '1k': { '1:1': [10, 10] as const } }
    expect(() => lookupSize(map, '1k', '7:3')).toThrowError(ValidationError)
    expect(() => lookupSize(map, '1k', '7:3')).toThrow(/not supported/)
  })
})
