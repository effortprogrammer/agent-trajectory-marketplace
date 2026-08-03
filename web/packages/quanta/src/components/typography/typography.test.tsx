import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Typography, typography } from './index.ts'

describe('<Typography>', () => {
  it('defaults to a <p> with the body-md-regular composite utility', () => {
    render(<Typography>Hello</Typography>)
    const el = screen.getByText('Hello')
    expect(el.tagName).toBe('P')
    expect(el).toHaveClass('text-q-body-md-regular')
  })

  it('applies the matching text-q-* utility for a given variant', () => {
    render(<Typography variant="headline-lg-semi-bold">Title</Typography>)
    expect(screen.getByText('Title')).toHaveClass('text-q-headline-lg-semi-bold')
  })

  it('renders the element named by `as`', () => {
    render(<Typography as="h1" variant="display-lg-bold">Big</Typography>)
    const el = screen.getByText('Big')
    expect(el.tagName).toBe('H1')
    expect(el).toHaveClass('text-q-display-lg-bold')
  })

  it('maps color to the semantic text-q-text-* utility', () => {
    render(<Typography color="secondary">Muted</Typography>)
    expect(screen.getByText('Muted')).toHaveClass('text-q-text-secondary')
  })

  it('omits a colour class when color is not set (inherits)', () => {
    render(<Typography>Inherit</Typography>)
    const cls = screen.getByText('Inherit').className
    expect(cls).not.toMatch(/text-q-text-/)
  })

  it('adds the truncate utility when truncate is set', () => {
    render(<Typography truncate>Long text</Typography>)
    expect(screen.getByText('Long text')).toHaveClass('truncate')
  })

  it('does not truncate by default', () => {
    render(<Typography>Plain</Typography>)
    expect(screen.getByText('Plain')).not.toHaveClass('truncate')
  })

  it('applies the caller className last so it wins ordering', () => {
    render(<Typography className="is-custom">Custom</Typography>)
    const el = screen.getByText('Custom')
    expect(el).toHaveClass('text-q-body-md-regular', 'is-custom')
    expect(el.className.trim().endsWith('is-custom')).toBe(true)
  })

  it('forwards native props to the rendered element', () => {
    render(<Typography as="span" title="tip" data-testid="t">x</Typography>)
    const el = screen.getByTestId('t')
    expect(el.tagName).toBe('SPAN')
    expect(el).toHaveAttribute('title', 'tip')
  })

  describe('typography() recipe', () => {
    it('returns the default body-md-regular class', () => {
      expect(typography()).toBe('text-q-body-md-regular')
    })

    it('composes variant + color + truncate + extra in order', () => {
      expect(typography({ variant: 'label-md-semi-bold', color: 'brand', truncate: true }, 'extra')).toBe(
        'text-q-label-md-semi-bold text-q-text-brand truncate extra',
      )
    })
  })
})
