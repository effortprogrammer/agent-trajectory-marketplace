import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Loader } from './index.ts'

describe('<Loader>', () => {
  it('renders a status role with the default label, variant and size', () => {
    render(<Loader />)
    const el = screen.getByRole('status', { name: 'Loading' })
    expect(el).toHaveClass('q-loader', 'q-loader-circle', 'q-loader-md')
  })

  it('renders four dots for the dots variant', () => {
    const { container } = render(<Loader variant="dots" />)
    expect(container.querySelectorAll('.q-loader-dot')).toHaveLength(4)
  })

  it('renders the spinner svg for the circle variant', () => {
    const { container } = render(<Loader variant="circle" />)
    expect(container.querySelector('.q-loader-spinner')).toBeInTheDocument()
  })

  it('renders two sparkles for the stars variant', () => {
    const { container } = render(<Loader variant="stars" />)
    expect(container.querySelectorAll('.q-loader-star')).toHaveLength(2)
  })

  it('applies the requested size and a custom label', () => {
    render(<Loader variant="shine" size="lg" aria-label="Generating" />)
    expect(screen.getByRole('status', { name: 'Generating' })).toHaveClass('q-loader-shine', 'q-loader-lg')
  })

  it('wires the slot color via inline custom properties', () => {
    render(<Loader color="success" />)
    const el = screen.getByRole('status')
    expect(el.style.getPropertyValue('--q-tint')).not.toBe('')
  })

  it('disables motion with animated={false}', () => {
    render(<Loader />)
    const animated = screen.getByRole('status')
    expect(animated).not.toHaveAttribute('data-static')

    render(<Loader animated={false} aria-label="Static" />)
    expect(screen.getByRole('status', { name: 'Static' })).toHaveAttribute('data-static')
  })

  it('forwards className and native div props', () => {
    render(<Loader className="is-custom" id="load" />)
    const el = screen.getByRole('status')
    expect(el).toHaveClass('is-custom')
    expect(el).toHaveAttribute('id', 'load')
  })
})
