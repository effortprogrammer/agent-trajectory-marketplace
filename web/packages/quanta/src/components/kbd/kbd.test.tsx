import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Kbd, KbdSequence } from './index.ts'

describe('<Kbd>', () => {
  it('renders a semantic <kbd> as the Figma _Shortcut pill (single size, token styles)', () => {
    render(<Kbd>K</Kbd>)
    const key = screen.getByText('K')
    expect(key.tagName).toBe('KBD')
    expect(key).toHaveClass(
      'inline-flex',
      'h-5',
      'gap-0.5',
      'rounded-q-100',
      'px-1',
      'border-q-hairline',
      'border-q-border-subtle',
      'bg-q-overlay-hover',
      'text-q-text-primary',
      'text-q-caption-sm-medium',
    )
  })

  it('forwards className and native kbd props', () => {
    render(<Kbd className="is-custom" title="Command">⌘</Kbd>)
    const key = screen.getByText('⌘')
    expect(key).toHaveClass('is-custom')
    expect(key).toHaveAttribute('title', 'Command')
  })
})

describe('<KbdSequence>', () => {
  it('wraps string keys in <Kbd> and renders separators between them', () => {
    const { container } = render(<KbdSequence keys={['⌘', 'K']} />)
    const kbds = container.querySelectorAll('kbd')
    expect(kbds).toHaveLength(2)
    expect(kbds[0]).toHaveTextContent('⌘')
    expect(kbds[1]).toHaveTextContent('K')

    const separators = container.querySelectorAll('[aria-hidden="true"]')
    // one separator between the two keys, styled via Typography
    expect(separators).toHaveLength(1)
    expect(separators[0]).toHaveTextContent('+')
    expect(separators[0]).toHaveClass('text-q-caption-sm-regular', 'text-q-text-tertiary')
  })

  it('omits the separator when set to null', () => {
    const { container } = render(<KbdSequence keys={['⇧', 'A']} separator={null} />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('accepts a custom separator and Kbd children', () => {
    const { container } = render(
      <KbdSequence separator="then">
        <Kbd>G</Kbd>
        <Kbd>I</Kbd>
      </KbdSequence>,
    )
    expect(container.querySelectorAll('kbd')).toHaveLength(2)
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('then')
  })
})
