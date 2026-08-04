import { describe, expect, it } from 'vitest'
import { type AdjustKind, clampDuration, closestAspectRatio, normalizeSettings } from '../normalize'

describe('closestAspectRatio', () => {
  it('returns the value unchanged when it is an allowed option', () => {
    expect(closestAspectRatio('16:9', ['1:1', '16:9', '9:16'])).toBe('16:9')
  })

  it('returns the closest option by aspect when not allowed', () => {
    expect(closestAspectRatio('1920:1081', ['1:1', '16:9', '9:16'])).toBe('16:9')
    expect(closestAspectRatio('100:101', ['1:1', '16:9'])).toBe('1:1')
  })
})

describe('clampDuration', () => {
  it('snaps to the nearest allowed value', () => {
    expect(clampDuration(7, { kind: 'duration', values: [5, 10] })).toBe(5)
    expect(clampDuration(8, { kind: 'duration', values: [5, 10] })).toBe(10)
  })

  it('clamps to a min/max range', () => {
    expect(clampDuration(2, { kind: 'duration', min: 4, max: 15 })).toBe(4)
    expect(clampDuration(20, { kind: 'duration', min: 4, max: 15 })).toBe(15)
    expect(clampDuration(8, { kind: 'duration', min: 4, max: 15 })).toBe(8)
  })
})

describe('normalizeSettings', () => {
  const ALL = new Set<AdjustKind>(['near-aspect-ratio', 'near-duration'])

  it('snaps enabled kinds and records the adjustments', () => {
    const out = normalizeSettings(
      { aspectRatio: '1920:1081', duration: 7, resolution: '720p' },
      {
        aspectRatio: { kind: 'aspectRatio', options: ['1:1', '16:9'] },
        duration: { kind: 'duration', values: [5, 10] },
      },
      ALL,
    )
    expect(out.settings).toEqual({ aspectRatio: '16:9', duration: 5, resolution: '720p' })
    expect(out.adjustments).toEqual([
      { field: 'aspectRatio', from: '1920:1081', to: '16:9' },
      { field: 'duration', from: 7, to: 5 },
    ])
  })

  it('leaves a kind untouched when it is not enabled (passthrough)', () => {
    const out = normalizeSettings(
      { aspectRatio: '1920:1081', duration: 7 },
      {
        aspectRatio: { kind: 'aspectRatio', options: ['1:1', '16:9'] },
        duration: { kind: 'duration', values: [5, 10] },
      },
      new Set<AdjustKind>(['near-aspect-ratio']), // duration not enabled
    )
    expect(out.settings).toEqual({ aspectRatio: '16:9', duration: 7 })
    expect(out.adjustments).toEqual([{ field: 'aspectRatio', from: '1920:1081', to: '16:9' }])
  })

  it('skips a normalizer when the value is absent', () => {
    const out = normalizeSettings(
      { resolution: '720p' },
      { aspectRatio: { kind: 'aspectRatio', options: ['1:1'] } },
      ALL,
    )
    expect(out.settings).toEqual({ resolution: '720p' })
    expect(out.adjustments).toEqual([])
  })
})
