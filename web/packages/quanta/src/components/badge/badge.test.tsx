import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge, badge } from './index.ts'

describe('badge() class-builder', () => {
  it('defaults to the blue skewed variant', () => {
    expect(badge()).toBe('q-badge q-badge-skew q-badge-blue')
  })

  it('applies compact variants and extra classes', () => {
    expect(badge({ variant: 'nBrand' }, 'is-custom', false)).toBe(
      'q-badge q-badge-compact q-badge-n-brand is-custom',
    )
  })

  it('applies the subtle lime skewed variant', () => {
    expect(badge({ variant: 'limeSubtle' })).toBe('q-badge q-badge-skew q-badge-lime-subtle')
  })
})

describe('<Badge>', () => {
  it('renders default text and classes', () => {
    render(<Badge />)

    const badgeControl = screen.getByText('Tag').closest('.q-badge')
    expect(badgeControl).toHaveClass('q-badge', 'q-badge-skew', 'q-badge-blue')
    expect(screen.getByText('Tag').closest('.q-badge-frame')).toBeTruthy()
  })

  it('renders compact default text', () => {
    render(<Badge variant="nBlue" />)

    const badgeControl = screen.getByText('new').closest('.q-badge')
    expect(badgeControl).toHaveClass('q-badge-compact', 'q-badge-n-blue')
  })

  it('lets children override text and forwards native props', () => {
    render(<Badge variant="purple" className="is-custom" title="Status">Exclusive</Badge>)

    const badgeControl = screen.getByText('Exclusive').closest('.q-badge')
    expect(badgeControl).toHaveClass('q-badge-purple', 'is-custom')
    expect(badgeControl).toHaveAttribute('title', 'Status')
  })
})
