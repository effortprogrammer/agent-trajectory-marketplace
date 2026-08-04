import type { Ref, SVGProps } from 'react'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, icon } from './index.ts'

/**
 * A minimal stand-in glyph that mirrors how @higgsfield-ai/icons render: it
 * spreads incoming props onto the <svg> last. Unlike the real package glyphs it
 * also forwards `ref` to the svg, so the ref-forwarding test exercises a glyph
 * that is capable of receiving it.
 */
function Glyph({ ref, ...props }: SVGProps<SVGSVGElement> & { ref?: Ref<SVGSVGElement> }) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" width={24} height={24} {...props}>
      <path stroke="currentColor" d="M5 13.875 9.2 18 19 7" />
    </svg>
  )
}

describe('<Icon>', () => {
  it('renders the glyph itself as the single element (no wrapper) — default md, decorative', () => {
    const { container } = render(<Icon as={Glyph} />)
    const svg = container.querySelector('svg')
    // the svg IS the root: no wrapping span around it
    expect(container.firstElementChild).toBe(svg)
    expect(svg).toHaveClass('q-icon', 'q-icon-md')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the glyph passed as children, painting q-icon onto its svg', () => {
    const { container } = render(<Icon><Glyph /></Icon>)
    const svg = container.querySelector('svg')
    expect(container.firstElementChild).toBe(svg)
    expect(svg).toHaveClass('q-icon', 'q-icon-md')
  })

  it('maps each size to its token utility class on the svg', () => {
    const cases = [
      ['xs', 'q-icon-xs'],
      ['sm', 'q-icon-sm'],
      ['md', 'q-icon-md'],
      ['lg', 'q-icon-lg'],
      ['xl', 'q-icon-xl'],
    ] as const

    for (const [size, cls] of cases) {
      const { container, unmount } = render(<Icon as={Glyph} size={size} />)
      expect(container.querySelector('svg')).toHaveClass('q-icon', cls)
      unmount()
    }
  })

  it('inherits currentColor by default (no color utility)', () => {
    const { container } = render(<Icon as={Glyph} />)
    expect(container.querySelector('svg')?.getAttribute('class')).not.toMatch(/text-q-icon-/)
  })

  it('applies a quanta icon color token when color is set', () => {
    const { container } = render(<Icon as={Glyph} color="brand" />)
    expect(container.querySelector('svg')).toHaveClass('text-q-icon-brand')
  })

  it('exposes an accessible image when a label is given', () => {
    render(<Icon as={Glyph} label="Search" />)
    const img = screen.getByRole('img', { name: 'Search' })
    expect(img.tagName.toLowerCase()).toBe('svg')
    expect(img).toHaveClass('q-icon')
    expect(img).not.toHaveAttribute('aria-hidden')
  })

  it('is hidden from assistive tech when unlabelled', () => {
    render(<Icon as={Glyph} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('forwards ref to the glyph svg', () => {
    const ref = createRef<SVGSVGElement>()
    render(<Icon as={Glyph} ref={ref} />)
    expect(ref.current).toBeInstanceOf(SVGSVGElement)
    expect(ref.current).toHaveClass('q-icon')
  })

  it('forwards className last (caller wins ordering) onto the svg', () => {
    const { container } = render(<Icon as={Glyph} className="is-custom" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('q-icon', 'q-icon-md', 'is-custom')
    expect(svg?.getAttribute('class')?.trim().endsWith('is-custom')).toBe(true)
  })

  it('`as` wins when both `as` and `children` are supplied', () => {
    const { container } = render(
      <Icon as={Glyph}><svg data-testid="child-svg" /></Icon>,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelector('[data-testid="child-svg"]')).not.toBeInTheDocument()
  })

  it('recipe `icon()` returns the composite class string', () => {
    expect(icon()).toBe('q-icon q-icon-md')
    expect(icon({ size: 'lg', color: 'success' })).toBe('q-icon q-icon-lg text-q-icon-success')
    expect(icon({ size: 'xs' }, 'extra')).toBe('q-icon q-icon-xs extra')
  })
})
