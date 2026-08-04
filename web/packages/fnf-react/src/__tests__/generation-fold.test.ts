import type { Generation } from '@higgsfield/fnf/client'
import { describe, expect, it } from 'vitest'
import { foldGeneration } from '../generation-fold'

function gen(id: string, status: Generation['status'], extra?: Partial<Generation>): Generation {
  return { id, model: 'demo', type: 'image', status, input: { model: 'demo', settings: {} }, ...extra }
}

describe('foldGeneration', () => {
  it('progress folds forward', () => {
    const prev = gen('a', 'queued')
    const next = gen('a', 'in_progress')
    expect(foldGeneration(prev, next)).toBe(next)
  })

  it('a stale snapshot can NOT reopen a settled generation (terminal anti-regress)', () => {
    const settled = gen('a', 'completed', { results: { rawUrl: 'https://x/a.png' } })
    const stale = gen('a', 'in_progress')
    expect(foldGeneration(settled, stale)).toBe(settled)
  })

  it('terminal → terminal still folds (a late fail reason, a fresher result url)', () => {
    const prev = gen('a', 'completed', { results: { rawUrl: 'https://x/a.png' } })
    const next = gen('a', 'completed', { results: { rawUrl: 'https://x/a.png', minUrl: 'https://x/a-min.png' } })
    expect(foldGeneration(prev, next)).toBe(next)
  })

  it('nothing observable changed → the PREVIOUS reference survives (memoization keeps working)', () => {
    const prev = gen('a', 'in_progress')
    const tick = gen('a', 'in_progress') // a poll tick re-parsed into a fresh object
    expect(foldGeneration(prev, tick)).toBe(prev)
  })

  it('no previous (or a different id) → the next snapshot wins', () => {
    const next = gen('a', 'queued')
    expect(foldGeneration(undefined, next)).toBe(next)
    expect(foldGeneration(gen('b', 'completed'), next)).toBe(next)
  })
})
