import { describe, expect, it } from 'vitest'
import { cx } from './cx.ts'

describe('cx', () => {
  it('joins truthy class names with a space', () => {
    expect(cx('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cx('a', false, undefined, null, '', 'b')).toBe('a b')
  })
})
