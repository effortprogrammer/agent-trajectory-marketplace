import { describe, expect, it } from 'vitest'
import { isTerminal, TERMINAL_STATUSES } from '../types'

describe('status helpers', () => {
  it('marks completed/failed/nsfw/canceled/ip_detected as terminal', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('nsfw')).toBe(true)
    expect(isTerminal('canceled')).toBe(true)
    expect(isTerminal('ip_detected')).toBe(true)
  })

  it('marks in-flight statuses as not terminal', () => {
    expect(isTerminal('pending')).toBe(false)
    expect(isTerminal('queued')).toBe(false)
    expect(isTerminal('in_progress')).toBe(false)
  })

  it('exposes exactly five terminal statuses', () => {
    expect(TERMINAL_STATUSES.size).toBe(5)
  })
})
