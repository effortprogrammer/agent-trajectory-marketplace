import { describe, expect, it } from 'vitest'
import { promptCodec } from '../prompt'

describe('promptCodec', () => {
  it('maps structured prompt to flat wire keys', () => {
    expect(promptCodec.serialize({ instruction: 'a cat', enhance: true, negative: 'blur' })).toEqual({
      prompt: 'a cat',
      enhance_prompt: true,
      negative_prompt: 'blur',
    })
  })

  it('parses flat wire keys back to structured prompt', () => {
    expect(promptCodec.parse({ prompt: 'a cat', enhance_prompt: true, system_prompt: 'be brief' })).toEqual({
      instruction: 'a cat',
      enhance: true,
      system: 'be brief',
    })
  })

  it('round-trips losslessly', () => {
    const x = { instruction: 'dog', enhance: false, negative: 'noise', system: 'x' }
    expect(promptCodec.parse(promptCodec.serialize(x))).toEqual(x)
  })
})
