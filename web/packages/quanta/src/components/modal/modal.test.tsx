import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Modal, modal } from './index.ts'

describe('modal() class-builder', () => {
  it('defaults to the md size', () => {
    expect(modal()).toBe('q-modal q-modal-size-md')
  })

  it('applies size and extra classes', () => {
    expect(modal({ size: 'lg' }, 'custom')).toBe('q-modal q-modal-size-lg custom')
  })

  it('includes the compact Figma xs size', () => {
    expect(modal({ size: 'xs' })).toBe('q-modal q-modal-size-xs')
  })
})

describe('<Modal> composition', () => {
  it('renders the Base UI dialog with composed quanta parts', () => {
    render(
      <Modal.Root defaultOpen>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>Modal title</Modal.Title>
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body>Body content</Modal.Body>
          <Modal.Footer>
            <Modal.FooterCaption>Footer caption</Modal.FooterCaption>
            <Modal.FooterActions><button type="button">Confirm</button></Modal.FooterActions>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Modal title' })
    expect(dialog).toHaveClass('q-modal', 'q-modal-size-md')
    expect(screen.getByText('Body content')).toHaveClass('q-modal-workspace', 'q-modal-workspace-padded')
    expect(screen.getByText('Footer caption')).toHaveClass('q-modal-caption')
    expect(screen.getByRole('button', { name: 'Confirm' }).closest('.q-modal-actions')).not.toBeNull()
    const closeButton = screen.getByRole('button', { name: 'Close' })
    expect(closeButton).toHaveClass('q-close')
    expect(closeButton.querySelector('.q-icon')).not.toBeNull()
  })

  it('composes the back / search / tabs header layouts', () => {
    const back = render(
      <Modal.Root defaultOpen>
        <Modal.Content aria-label="Back">
          <Modal.Header>
            <Modal.HeaderLead>
              <Modal.BackButton />
              <Modal.Title>Step 2</Modal.Title>
            </Modal.HeaderLead>
            <Modal.Spacer />
            <Modal.CloseButton />
          </Modal.Header>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(back.container.ownerDocument.querySelector('.q-modal-header-lead')).not.toBeNull()
    const backButton = back.getByRole('button', { name: 'Back' })
    expect(backButton).toHaveClass('q-close')
    expect(backButton.querySelector('.q-icon')).not.toBeNull()
    back.unmount()

    const search = render(
      <Modal.Root defaultOpen>
        <Modal.Content aria-label="Search">
          <Modal.Header flush>
            <Modal.Search placeholder="Find…" />
            <Modal.CloseButton />
          </Modal.Header>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(search.getByPlaceholderText('Find…')).toHaveClass('q-modal-search-input')
    expect(search.container.ownerDocument.querySelector('.q-modal-header-flush')).not.toBeNull()
    expect(search.container.ownerDocument.querySelector('.q-modal-search-icon .q-icon')).not.toBeNull()
    search.unmount()

    const tabs = render(
      <Modal.Root defaultOpen>
        <Modal.Content aria-label="Tabs">
          <Modal.Header flush>
            <div data-testid="pill">tabs</div>
            <Modal.Spacer />
            <Modal.CloseButton />
          </Modal.Header>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(tabs.getByTestId('pill')).toBeInTheDocument()
  })

  it('wraps plain body content in a single window, but keeps explicit Workspaces', () => {
    const single = render(
      <Modal.Root defaultOpen>
        <Modal.Content aria-label="Single"><Modal.Body>Plain</Modal.Body></Modal.Content>
      </Modal.Root>,
    )
    expect(single.container.ownerDocument.querySelectorAll('.q-modal-workspace')).toHaveLength(1)
    expect(single.getByText('Plain')).toHaveClass('q-modal-workspace')
    single.unmount()

    const split = render(
      <Modal.Root defaultOpen>
        <Modal.Content size="xl" aria-label="Split">
          <Modal.Body>
            <Modal.Workspace className="w-40 flex-none">Nav</Modal.Workspace>
            <Modal.Workspace>Content</Modal.Workspace>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(split.container.ownerDocument.querySelectorAll('.q-modal-workspace')).toHaveLength(2)
    expect(split.getByText('Nav')).toHaveClass('q-modal-workspace')
    expect(split.getByText('Content')).toHaveClass('q-modal-workspace')
  })

  it('applies the size preset to the popup', () => {
    render(
      <Modal.Root defaultOpen>
        <Modal.Content size="lg" aria-label="Large modal"><Modal.Body /></Modal.Content>
      </Modal.Root>,
    )
    expect(screen.getByRole('dialog', { name: 'Large modal' })).toHaveClass('q-modal-size-lg')
  })

  it('stretches footer actions when full', () => {
    render(
      <Modal.Root defaultOpen>
        <Modal.Content aria-label="Full footer">
          <Modal.Footer full>
            <Modal.FooterActions full><button type="button">Done</button></Modal.FooterActions>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(document.querySelector('.q-modal-footer-full')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Done' }).closest('.q-modal-actions-full')).not.toBeNull()
  })

  it('orders a trailing header control before the close button', () => {
    render(
      <Modal.Root defaultOpen>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>With actions</Modal.Title>
            <button type="button">Settings</button>
            <Modal.CloseButton />
          </Modal.Header>
        </Modal.Content>
      </Modal.Root>,
    )
    const settings = screen.getByRole('button', { name: 'Settings' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(settings.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders a header with no close affordance (body-only sheet)', () => {
    render(
      <Modal.Root defaultOpen>
        <Modal.Content aria-label="Sheet">
          <Modal.Header><Modal.Title>No close</Modal.Title></Modal.Header>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(screen.getByText('No close')).toHaveClass('q-modal-title')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('closes when the close button is pressed', async () => {
    const user = userEvent.setup()
    render(
      <Modal.Root defaultOpen>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>Dismissable</Modal.Title>
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body>Body</Modal.Body>
        </Modal.Content>
      </Modal.Root>,
    )
    expect(screen.getByRole('dialog', { name: 'Dismissable' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Dismissable' })).not.toBeInTheDocument(),
    )
  })
})
