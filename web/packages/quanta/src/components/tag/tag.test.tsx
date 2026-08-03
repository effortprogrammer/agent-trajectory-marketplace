import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Tag } from './index.ts'

describe('<Tag>', () => {
  it('renders its children inside a non-interactive span with the slot tint', () => {
    render(<Tag>Beta</Tag>)
    const label = screen.getByText('Beta')
    // The label sits in a truncating inner span; the container carries the slot bg.
    const container = label.closest('span.q-slot-bg-10')
    expect(container).toBeInTheDocument()
    expect(container).toHaveClass('q-slot-text', 'text-q-caption-sm-medium')
  })

  it('defaults to the neutral slot color (sets the --q-tint custom properties)', () => {
    render(<Tag>X</Tag>)
    const container = screen.getByText('X').closest('span.q-slot-bg-10') as HTMLElement
    // slotStyle('neutral') wires the private slot vars inline.
    expect(container.style.getPropertyValue('--q-tint-fg')).not.toBe('')
  })

  it('renders a trailing remove button only when onRemove is provided', () => {
    const { rerender } = render(<Tag>Closable</Tag>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<Tag onRemove={() => {}}>Closable</Tag>)
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('renders the remove glyph as a node-only Icon (decorative, xs-sized svg)', () => {
    render(<Tag onRemove={() => {}}>Closable</Tag>)
    const button = screen.getByRole('button', { name: 'Remove' })
    // Icon is node-only: q-icon/q-icon-xs and aria-hidden land directly on the svg.
    const glyph = button.querySelector('svg.q-icon.q-icon-xs')
    expect(glyph).toBeInTheDocument()
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
  })

  it('invokes onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()
    render(<Tag onRemove={onRemove}>Closable</Tag>)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('supports a custom remove label', () => {
    render(<Tag onRemove={() => {}} removeLabel="Dismiss tag">Closable</Tag>)
    expect(screen.getByRole('button', { name: 'Dismiss tag' })).toBeInTheDocument()
  })

  it('forwards className and native span props', () => {
    render(<Tag className="is-custom" id="t1">Y</Tag>)
    const container = screen.getByText('Y').closest('span.q-slot-bg-10')!
    expect(container).toHaveClass('is-custom')
    expect(container).toHaveAttribute('id', 't1')
  })

  it('renders start before the label and end after it (before remove)', async () => {
    const onRemove = vi.fn()
    render(
      <Tag
        start={<span data-testid="lead" />}
        end={<span data-testid="trail" />}
        onRemove={onRemove}
      >
        Label
      </Tag>,
    )
    const lead = screen.getByTestId('lead')
    const label = screen.getByText('Label')
    const trail = screen.getByTestId('trail')
    const remove = screen.getByRole('button', { name: 'Remove' })
    // DOM order: start → label → end → remove
    expect(lead.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(label.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trail.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no slot wrappers when start/end are omitted (back-compat)', () => {
    render(<Tag>Plain</Tag>)
    const container = screen.getByText('Plain').closest('span.q-slot-bg-10')!
    // only the truncating label span (no flanking slot spans, no remove button)
    expect(container.querySelectorAll(':scope > span')).toHaveLength(1)
    expect(container.querySelector('button')).toBeNull()
  })
})
