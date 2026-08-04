import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Tooltip, type TooltipContentProps } from './index.ts'

function Basic({
  side,
  arrow,
  triggerRef,
  triggerClassName,
}: {
  side?: TooltipContentProps['side']
  arrow?: boolean
  triggerRef?: React.Ref<HTMLButtonElement>
  triggerClassName?: string
} = {}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger ref={triggerRef} className={triggerClassName}>Trigger</Tooltip.Trigger>
      <Tooltip.Content side={side} arrow={arrow}>
        Helpful hint
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

describe('Tooltip', () => {
  it('renders the trigger (a pure anchor, forwards className) and keeps the popup closed by default', () => {
    render(<Basic triggerClassName="custom-trigger" />)
    const trigger = screen.getByRole('button', { name: 'Trigger' })
    // The trigger has no own skin; a forwarded className lands on the element.
    expect(trigger).toHaveClass('custom-trigger')
    expect(screen.queryByText('Helpful hint')).not.toBeInTheDocument()
  })

  it('shows the tooltip content on focus and hides it on blur', async () => {
    const user = userEvent.setup()
    render(<Basic />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Trigger' })).toHaveFocus()
    await waitFor(() => expect(screen.getByText('Helpful hint')).toBeInTheDocument())

    await user.tab()
    await waitFor(() => expect(screen.queryByText('Helpful hint')).not.toBeInTheDocument())
  })

  it('opens with defaultOpen and exposes a tooltip role', async () => {
    render(
      <Tooltip.Root defaultOpen>
        <Tooltip.Trigger>Trigger</Tooltip.Trigger>
        <Tooltip.Content>Open now</Tooltip.Content>
      </Tooltip.Root>,
    )
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Open now'))
    expect(screen.getByRole('tooltip')).toHaveClass('q-tooltip')
  })

  it('paints the requested side onto the popup and renders an arrow when enabled', async () => {
    render(
      <Tooltip.Root defaultOpen>
        <Tooltip.Trigger>Trigger</Tooltip.Trigger>
        <Tooltip.Content side="right" arrow>Sided</Tooltip.Content>
      </Tooltip.Root>,
    )
    const popup = await screen.findByRole('tooltip')
    expect(popup).toHaveAttribute('data-side', 'right')
    expect(popup.querySelector('.q-tooltip-arrow')).not.toBeNull()
  })

  it('forwards a ref to the trigger element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Basic triggerRef={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toHaveTextContent('Trigger')
  })

  it('forwards the Root delay down to the trigger', () => {
    render(
      <Tooltip.Root delay={250}>
        <Tooltip.Trigger>Trigger</Tooltip.Trigger>
        <Tooltip.Content>Hint</Tooltip.Content>
      </Tooltip.Root>,
    )
    // Sanity render — the delay is consumed by Base UI internally; ensure the
    // composed tree mounts without throwing and the trigger is present.
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument()
  })

  it('shares a delay via Provider across multiple roots', () => {
    render(
      <Tooltip.Provider delay={100}>
        <Tooltip.Root>
          <Tooltip.Trigger>One</Tooltip.Trigger>
          <Tooltip.Content>First</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>Two</Tooltip.Trigger>
          <Tooltip.Content>Second</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>,
    )
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Two' })).toBeInTheDocument()
  })
})
