import { describe, expect, it } from 'vitest'
import { field, group } from '../group'

const codec = group({
  instruction: field('prompt'),
  enhance: field('enhance_prompt'),
})

describe('group codec', () => {
  it('serializes structured keys to wire keys, dropping undefined', () => {
    expect(codec.serialize({ instruction: 'cat', enhance: true })).toEqual({
      prompt: 'cat',
      enhance_prompt: true,
    })
    expect(codec.serialize({ instruction: 'cat' })).toEqual({ prompt: 'cat' })
  })

  it('parses wire keys back to structured keys', () => {
    expect(codec.parse({ prompt: 'cat', enhance_prompt: true })).toEqual({
      instruction: 'cat',
      enhance: true,
    })
  })

  it('exposes the wire keys it claims', () => {
    expect(codec.wireKeys.sort()).toEqual(['enhance_prompt', 'prompt'])
  })

  it('round-trips: parse(serialize(x)) === x', () => {
    const x = { instruction: 'dog', enhance: false }
    expect(codec.parse(codec.serialize(x))).toEqual(x)
  })
})
