import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Divider } from './index.ts'

describe('<Divider>', () => {
  it('defaults to a semantic <hr> with the etched horizontal styling', () => {
    const { container } = render(<Divider data-testid="d" />)
    const hr = container.querySelector('hr')!
    expect(hr).toBeInTheDocument()
    expect(hr).toHaveClass('q-divider', 'block', 'w-full')
  })

  it('renders vertical orientation as an <hr> that stretches in a flex row', () => {
    const { container } = render(<Divider orientation="vertical" />)
    const hr = container.querySelector('hr')!
    expect(hr).toHaveAttribute('aria-orientation', 'vertical')
    expect(hr).toHaveClass('q-divider-vertical', 'self-stretch')
  })

  it('switches to role=separator with flanking etched rules when labelled', () => {
    render(<Divider>or</Divider>)
    const sep = screen.getByRole('separator')
    expect(sep.tagName).toBe('DIV')
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal')
    const label = screen.getByText('or')
    expect(label.tagName).toBe('SPAN')
    expect(label).toHaveClass('text-q-text-tertiary', 'text-q-caption-sm-medium')
    const rules = sep.querySelectorAll('[aria-hidden="true"]')
    expect(rules).toHaveLength(2)
    rules.forEach(rule => expect(rule).toHaveClass('q-divider'))
  })

  it('forwards className and native hr props on the unlabelled variant', () => {
    const { container } = render(<Divider className="is-custom" id="sep" />)
    const hr = container.querySelector('hr')!
    expect(hr).toHaveClass('is-custom')
    expect(hr).toHaveAttribute('id', 'sep')
  })
})
