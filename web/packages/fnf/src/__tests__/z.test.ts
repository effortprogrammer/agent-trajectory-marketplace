import { describe, expect, it } from 'vitest'
import { aspectRatio, duration, getNormalize, z } from '../z'

describe('z helpers', () => {
  it('re-exports zod/mini primitives', () => {
    expect(typeof z.object).toBe('function')
    expect(typeof z.string).toBe('function')
    expect(typeof z.number).toBe('function')
  })

  it('aspectRatio validates against its options and carries a normalize tag', () => {
    const schema = aspectRatio(['1:1', '16:9'])
    expect(schema.parse('16:9')).toBe('16:9')
    expect(getNormalize(schema)).toEqual({ kind: 'aspectRatio', options: ['1:1', '16:9'] })
  })

  it('duration validates a number and carries a normalize tag with values', () => {
    const schema = duration({ values: [5, 10] })
    expect(schema.parse(10)).toBe(10)
    expect(getNormalize(schema)).toEqual({ kind: 'duration', values: [5, 10] })
  })

  it('duration supports a min/max range tag', () => {
    const schema = duration({ min: 4, max: 15 })
    expect(getNormalize(schema)).toEqual({ kind: 'duration', min: 4, max: 15 })
  })
})
