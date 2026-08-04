import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dot } from './index.ts'

describe('<Dot>', () => {
  it('defaults to a green medium dot with a thick glass ring', () => {
    const { container } = render(<Dot />)
    const dot = container.querySelector('span')
    expect(dot).toHaveClass(
      'rounded-q-full',
      'box-content',
      'size-q-200',
      'border-q-thick',
      'bg-q-palette-mint-bg',
      'border-q-background-glass',
      'q-dot',
    )
  })

  it('maps the Figma size ramp to fill box + outer stroke width', () => {
    const xs = render(<Dot size="xs" />)
    expect(xs.container.querySelector('span')).toHaveClass('size-q-100', 'border-q-medium', 'border-q-transparent-light-05')
    xs.unmount()

    const sm = render(<Dot size="sm" />)
    expect(sm.container.querySelector('span')).toHaveClass('size-q-150', 'border-q-medium', 'border-q-background-glass')
    sm.unmount()

    const md = render(<Dot size="md" />)
    expect(md.container.querySelector('span')).toHaveClass('size-q-200', 'border-q-thick', 'border-q-background-glass')
  })

  it('uses the exact Figma border color for every color and size variant', () => {
    const colors = ['green', 'yellow', 'red', 'grey'] as const
    const sizes = ['md', 'sm', 'xs'] as const

    for (const color of colors) {
      for (const size of sizes) {
        const { container, unmount } = render(<Dot color={color} size={size} />)
        const expected = color === 'green' && size === 'xs'
          ? 'border-q-transparent-light-05'
          : 'border-q-background-glass'

        expect(container.querySelector('span')).toHaveClass(expected)
        unmount()
      }
    }
  })

  it('paints each presence colour with its Figma palette token', () => {
    const cases = [
      ['green', 'bg-q-palette-mint-bg'],
      ['yellow', 'bg-q-brand-yellow'],
      ['red', 'bg-q-palette-pink-bg'],
      ['grey', 'bg-q-icon-secondary'],
    ] as const

    for (const [color, fill] of cases) {
      const { container, unmount } = render(<Dot color={color} />)
      expect(container.querySelector('span')).toHaveClass(fill)
      unmount()
    }
  })

  it('exposes an accessible image when a label is given', () => {
    render(<Dot color="red" size="sm" label="busy" />)
    const dot = screen.getByRole('img', { name: 'busy' })
    expect(dot).toHaveClass('size-q-150', 'border-q-medium', 'bg-q-palette-pink-bg')
  })

  it('is hidden from assistive tech when unlabelled', () => {
    const { container } = render(<Dot />)
    const dot = container.querySelector('span')
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('forwards className and native span props', () => {
    const { container } = render(<Dot className="is-custom" title="Presence" />)
    const dot = container.querySelector('span')
    expect(dot).toHaveClass('is-custom', 'rounded-q-full')
    expect(dot).toHaveAttribute('title', 'Presence')
  })

  it('is static (no animation classes) by default', () => {
    const { container } = render(<Dot />)
    const dot = container.querySelector('span')
    expect(dot).not.toHaveClass('q-dot-pulse', 'q-dot-glow')
    // no ink (currentColor) class when not animating
    expect(dot).not.toHaveClass('text-q-palette-mint-bg')
  })

  it('opts into pulse / glow and inherits the fill colour for the effect', () => {
    const pulse = render(<Dot animation="pulse" />)
    // green default → fill + matching ink so the rings/halo use currentColor
    expect(pulse.container.querySelector('span')).toHaveClass('q-dot-pulse', 'text-q-palette-mint-bg')
    pulse.unmount()

    const glow = render(<Dot color="red" animation="glow" />)
    expect(glow.container.querySelector('span')).toHaveClass('q-dot-glow', 'text-q-palette-pink-bg')
  })
})
