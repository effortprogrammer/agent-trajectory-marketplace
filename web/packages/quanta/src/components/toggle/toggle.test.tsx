import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Toggle } from './index.ts'

describe('<Toggle>', () => {
  it('renders a pressable button, unpressed by default', () => {
    render(<Toggle>Bold</Toggle>)
    const btn = screen.getByRole('button', { name: 'Bold' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('reflects defaultPressed (uncontrolled) via data-pressed', () => {
    render(<Toggle defaultPressed>On</Toggle>)
    const btn = screen.getByRole('button', { name: 'On' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('data-pressed')
  })

  it('toggles on click and fires onPressedChange', async () => {
    const onPressedChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle onPressedChange={onPressedChange}>Tap</Toggle>)
    const btn = screen.getByRole('button', { name: 'Tap' })
    await user.click(btn)
    expect(onPressedChange).toHaveBeenCalledWith(true, expect.anything())
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('applies the md size classes by default', () => {
    render(<Toggle>M</Toggle>)
    expect(screen.getByRole('button', { name: 'M' })).toHaveClass('q-toggle', 'q-toggle-md')
  })

  it('maps size to its token sizing classes', () => {
    const { rerender } = render(<Toggle size="sm">S</Toggle>)
    expect(screen.getByRole('button', { name: 'S' })).toHaveClass('q-toggle-sm')

    rerender(<Toggle size="lg">L</Toggle>)
    expect(screen.getByRole('button', { name: 'L' })).toHaveClass('q-toggle-lg')
  })

  it('wires the slot color custom properties from the color prop', () => {
    render(<Toggle color="success">C</Toggle>)
    const btn = screen.getByRole('button', { name: 'C' }) as HTMLElement
    expect(btn.style.getPropertyValue('--q-tint')).not.toBe('')
  })

  it('forwards a string className alongside the base classes', () => {
    render(<Toggle className="is-custom">X</Toggle>)
    expect(screen.getByRole('button', { name: 'X' })).toHaveClass('is-custom')
  })

  it('renders start before and end after the label', () => {
    render(
      <Toggle start={<span data-testid="lead" />} end={<span data-testid="trail" />}>
        Label
      </Toggle>,
    )
    const btn = screen.getByRole('button', { name: /Label/ })
    const lead = screen.getByTestId('lead')
    const trail = screen.getByTestId('trail')
    expect(btn).toContainElement(lead)
    expect(btn).toContainElement(trail)
    // DOM order: start → label → end
    expect(lead.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(btn.textContent).toBe('Label')
  })

  it('renders children bare when no slot is passed (back-compat)', () => {
    render(<Toggle>Plain</Toggle>)
    const btn = screen.getByRole('button', { name: 'Plain' })
    // no slot wrappers added — the button contains only the text
    expect(btn.childElementCount).toBe(0)
    expect(btn).toHaveTextContent('Plain')
  })
})
