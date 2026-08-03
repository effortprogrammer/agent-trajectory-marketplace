import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Accordion } from './index.ts'

/** A minimal three-item accordion built from the public parts. */
function Basic(props: Parameters<typeof Accordion.Root>[0] = {}) {
  return (
    <Accordion.Root {...props}>
      <Accordion.Item value="a">
        <Accordion.Trigger>First</Accordion.Trigger>
        <Accordion.Panel>Panel A</Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="b">
        <Accordion.Trigger>Second</Accordion.Trigger>
        <Accordion.Panel>Panel B</Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="c" disabled>
        <Accordion.Trigger>Third</Accordion.Trigger>
        <Accordion.Panel>Panel C</Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  )
}

describe('<Accordion>', () => {
  it('renders triggers as buttons inside accessible headings', () => {
    render(<Basic />)
    const trigger = screen.getByRole('button', { name: 'First' })
    expect(trigger).toHaveClass('q-accordion-trigger')
    // Base UI wraps the trigger in an <h3> Header.
    expect(trigger.closest('.q-accordion-header')?.tagName).toBe('H3')
  })

  it('expands a panel when its trigger is pressed and toggles aria-expanded', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const trigger = screen.getByRole('button', { name: 'First' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('data-panel-open')
    expect(screen.getByText('Panel A')).toBeInTheDocument()
  })

  it('collapses the open item when a second is opened (single mode default)', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const first = screen.getByRole('button', { name: 'First' })
    const second = screen.getByRole('button', { name: 'Second' })

    await user.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    await user.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps multiple panels open when multiple is set', async () => {
    const user = userEvent.setup()
    render(<Basic multiple />)
    const first = screen.getByRole('button', { name: 'First' })
    const second = screen.getByRole('button', { name: 'Second' })

    await user.click(first)
    await user.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-expanded', 'true')
  })

  it('honours defaultValue to open an item initially', () => {
    render(<Basic defaultValue={['b']} />)
    expect(screen.getByRole('button', { name: 'Second' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'First' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('fires onValueChange with the new open set', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Basic onValueChange={onValueChange} />)
    await user.click(screen.getByRole('button', { name: 'First' }))
    expect(onValueChange).toHaveBeenCalled()
    expect(onValueChange.mock.lastCall?.[0]).toEqual(['a'])
  })

  it('disables an item via the disabled prop', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const disabled = screen.getByRole('button', { name: 'Third' })
    expect(disabled).toHaveAttribute('data-disabled')
    await user.click(disabled)
    expect(disabled).toHaveAttribute('aria-expanded', 'false')
  })

  it('applies the variant class to the root', () => {
    const { rerender } = render(<Basic variant="separated" />)
    const root = screen.getByRole('button', { name: 'First' }).closest('.q-accordion') as HTMLElement
    expect(root).toHaveClass('q-accordion-separated')

    rerender(<Basic variant="list" />)
    expect(screen.getByRole('button', { name: 'First' }).closest('.q-accordion')).toHaveClass('q-accordion-list')
  })

  it('renders start and end slots in the trigger', () => {
    render(
      <Accordion.Root>
        <Accordion.Item value="a">
          <Accordion.Trigger start={<span data-testid="lead" />} end={<span data-testid="trail" />}>
            Labelled
          </Accordion.Trigger>
          <Accordion.Panel>Body</Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>,
    )
    expect(screen.getByTestId('lead').closest('.q-accordion-trigger-start')).toBeInTheDocument()
    expect(screen.getByTestId('trail').closest('.q-accordion-trigger-end')).toBeInTheDocument()
    expect(screen.getByText('Labelled').closest('.q-accordion-trigger-label')).toBeInTheDocument()
  })

  it('forwards a ref to the root element', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Accordion.Root ref={ref}>
        <Accordion.Item value="a">
          <Accordion.Trigger>First</Accordion.Trigger>
          <Accordion.Panel>Panel A</Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>,
    )
    expect(ref.current).toBeInstanceOf(HTMLElement)
    expect(ref.current).toHaveClass('q-accordion')
  })
})
