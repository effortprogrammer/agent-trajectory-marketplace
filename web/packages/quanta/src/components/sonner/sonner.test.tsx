import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Toaster, toast } from './index.ts'

afterEach(() => {
  act(() => toast.dismiss())
})

describe('toast imperative API', () => {
  it('exposes the sonner-shaped surface', () => {
    expect(typeof toast).toBe('function')
    for (const m of ['success', 'error', 'warning', 'info', 'loading', 'message', 'dismiss', 'promise'])
      expect(typeof (toast as unknown as Record<string, unknown>)[m]).toBe('function')
  })
})

describe('<Toaster>', () => {
  it('renders a fired toast with its title + description', async () => {
    render(<Toaster />)
    act(() => { toast.success('Saved', { description: 'All good' }) })

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('applies the variant class', async () => {
    render(<Toaster />)
    act(() => { toast.error('Boom') })

    const title = await screen.findByText('Boom')
    expect(title.closest('.q-sonner')).toHaveClass('q-sonner-error')
  })

  it('renders the variant glyph through <Icon>', async () => {
    render(<Toaster />)
    act(() => { toast.success('Saved') })

    const card = (await screen.findByText('Saved')).closest('.q-sonner')
    // the status glyph is an <Icon>: q-icon is painted on the glyph svg inside the icon slot
    expect(card?.querySelector('.q-sonner-icon .q-icon')).toBeInTheDocument()
  })

  it('dismiss() removes toasts', async () => {
    render(<Toaster />)
    act(() => { toast('Temporary') })
    expect(await screen.findByText('Temporary')).toBeInTheDocument()

    act(() => { toast.dismiss() })
    await waitFor(() => expect(screen.queryByText('Temporary')).not.toBeInTheDocument())
  })

  it('renders a simple { label, onClick } action via the built-in button (back-compat)', async () => {
    render(<Toaster />)
    act(() => { toast('Message sent', { action: { label: 'Undo' } }) })
    const action = await screen.findByText('Undo')
    // built-in action keeps the q-sonner-action button styling
    expect(action).toHaveClass('q-sonner-action')
  })

  it('renders a custom ReactNode action in the action slot', async () => {
    render(<Toaster />)
    act(() => {
      toast('Saved', { action: <button type="button" data-testid="custom-action">Open</button> })
    })
    const custom = await screen.findByTestId('custom-action')
    expect(custom.closest('.q-sonner-action-slot')).toBeInTheDocument()
    // the custom node is NOT wrapped in the built-in action button
    expect(custom).not.toHaveClass('q-sonner-action')
  })
})
