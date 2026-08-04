import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Glass, glass } from './index.ts'

describe('Glass', () => {
  it('renders children inside the glass surface', () => {
    render(<Glass>Frosted</Glass>)
    const surface = screen.getByText('Frosted')
    expect(surface).toHaveClass('q-glass')
  })

  it('applies the default blur / elevation / rounded classes', () => {
    render(<Glass data-testid="g">x</Glass>)
    const surface = screen.getByTestId('g')
    expect(surface).toHaveClass('q-glass', 'q-glass-blur-md', 'q-glass-rounded-600')
    expect(surface).not.toHaveClass('q-glass-raised')
  })

  it('maps blur / elevation / rounded props to their utility classes', () => {
    render(<Glass data-testid="g" blur="lg" elevation="raised" rounded="300">x</Glass>)
    const surface = screen.getByTestId('g')
    expect(surface).toHaveClass('q-glass-blur-lg', 'q-glass-raised', 'q-glass-rounded-300')
  })

  it('opts into the interactive treatment', () => {
    render(<Glass data-testid="g" interactive>x</Glass>)
    expect(screen.getByTestId('g')).toHaveClass('q-glass-interactive')
  })

  it('applies a tint via the slot system (class + --q-tint var)', () => {
    render(<Glass data-testid="g" tint="brand">x</Glass>)
    const surface = screen.getByTestId('g')
    expect(surface).toHaveClass('q-glass-tinted')
    expect(surface.style.getPropertyValue('--q-tint')).not.toBe('')
  })

  it('does not set the tint class or var when no tint is given', () => {
    render(<Glass data-testid="g">x</Glass>)
    const surface = screen.getByTestId('g')
    expect(surface).not.toHaveClass('q-glass-tinted')
    expect(surface.style.getPropertyValue('--q-tint')).toBe('')
  })

  it('keeps the caller className last and forwards arbitrary props', () => {
    render(<Glass data-testid="g" className="custom" aria-label="panel">x</Glass>)
    const surface = screen.getByTestId('g')
    expect(surface).toHaveClass('q-glass', 'custom')
    expect(surface).toHaveAttribute('aria-label', 'panel')
  })

  it('swaps the host element via render while keeping the surface', () => {
    render(<Glass render={<article />} data-testid="g">x</Glass>)
    const surface = screen.getByTestId('g')
    expect(surface.tagName).toBe('ARTICLE')
    expect(surface).toHaveClass('q-glass')
  })

  it('forwards a click on an interactive render host', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Glass render={<button type="button" />} interactive onClick={onClick}>Press</Glass>)
    await user.click(screen.getByRole('button', { name: 'Press' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('forwards a ref to the root element', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Glass ref={ref} data-testid="g">x</Glass>)
    expect(ref.current).toBe(screen.getByTestId('g'))
  })
})

describe('glass() recipe', () => {
  it('builds the default class string', () => {
    expect(glass()).toBe('q-glass q-glass-blur-md q-glass-rounded-600')
  })

  it('reflects options and appends extra classes', () => {
    expect(glass({ blur: 'sm', elevation: 'raised', rounded: 'full', interactive: true }, 'extra')).toBe(
      'q-glass q-glass-blur-sm q-glass-raised q-glass-rounded-full q-glass-interactive extra',
    )
  })
})
