import { render, screen } from '@testing-library/react'
import { IconCircleOutlined as CircleIcon } from '@higgsfield-ai/icons/IconCircleOutlined'
import { describe, expect, it } from 'vitest'
import { Chip, chip } from './index.ts'

describe('chip() class-builder', () => {
  it('defaults to brand + sm', () => {
    expect(chip()).toBe('q-chip q-chip-brand q-chip-sm')
  })

  it('applies color + size + selected', () => {
    expect(chip({ color: 'success', size: 'md', selected: true })).toBe(
      'q-chip q-chip-success q-chip-md q-chip-selected',
    )
  })

  it('merges extra classes and drops falsy values', () => {
    expect(chip({ color: 'error' }, 'is-custom', false)).toBe('q-chip q-chip-error q-chip-sm is-custom')
  })
})

describe('<Chip>', () => {
  it('renders a button with default type and classes', () => {
    render(<Chip>Filter</Chip>)

    const chipControl = screen.getByRole('button', { name: 'Filter' })
    expect(chipControl).toHaveAttribute('type', 'button')
    expect(chipControl).toHaveAttribute('aria-pressed', 'false')
    expect(chipControl).toHaveClass('q-chip', 'q-chip-brand', 'q-chip-sm')
  })

  it('renders selected state', () => {
    render(<Chip color="neutral" size="md" selected>Filter</Chip>)

    const chipControl = screen.getByRole('button', { name: 'Filter' })
    expect(chipControl).toHaveAttribute('aria-pressed', 'true')
    expect(chipControl).toHaveAttribute('data-selected')
    expect(chipControl).toHaveClass('q-chip-neutral', 'q-chip-md', 'q-chip-selected')
  })

  it('forwards native props and caller classes', () => {
    render(<Chip className="is-custom" disabled type="submit">Filter</Chip>)

    const chipControl = screen.getByRole('button', { name: 'Filter' })
    expect(chipControl).toHaveClass('q-chip', 'is-custom')
    expect(chipControl).toBeDisabled()
    expect(chipControl).toHaveAttribute('type', 'submit')
  })

  it('composes start / end slots around the label', () => {
    render(<Chip start={<CircleIcon data-testid="lead" />} end={<span data-testid="count">3</span>}>Tags</Chip>)
    const chipControl = screen.getByRole('button', { name: /tags/i })
    expect(chipControl).toHaveTextContent('Tags')
    expect(screen.getByTestId('lead')).toBeInTheDocument()
    expect(screen.getByTestId('count')).toBeInTheDocument()
  })

  it('renders bare children when no slot is passed (back-compat)', () => {
    render(<Chip><CircleIcon data-testid="icon" />Label</Chip>)
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('Label')
  })
})
