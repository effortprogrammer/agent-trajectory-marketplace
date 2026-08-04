import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Vault } from './index.ts'

function open(side?: Parameters<typeof Vault.Root>[0]['side']) {
  return render(
    <Vault.Root defaultOpen side={side}>
      <Vault.Content>
        <Vault.Header title="Filters" />
        <Vault.Body>Body content</Vault.Body>
        <Vault.Footer caption="2 selected" />
      </Vault.Content>
    </Vault.Root>,
  )
}

describe('<Vault>', () => {
  it('renders the docked sheet with title, body and footer', () => {
    open()
    expect(screen.getByText('Filters')).toHaveClass('q-vault-title')
    expect(screen.getByText('Body content')).toHaveClass('q-vault-body')
    expect(screen.getByText('2 selected')).toHaveClass('q-vault-caption')
  })

  it('defaults to the bottom side and shows a handle', () => {
    open()
    const popup = screen.getByText('Filters').closest('.q-vault')
    expect(popup).toHaveClass('q-vault-bottom')
    expect(popup?.querySelector('.q-vault-handle')).toBeInTheDocument()
  })

  it('docks to the requested side (no handle off-bottom)', () => {
    open('right')
    const popup = screen.getByText('Filters').closest('.q-vault')
    expect(popup).toHaveClass('q-vault-right')
    expect(popup?.querySelector('.q-vault-handle')).not.toBeInTheDocument()
  })

  it('renders a default close button in the header with an Icon glyph', () => {
    open()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveClass('q-close')
    // Icon is node-only: the glyph svg itself carries the q-icon sizing class.
    const glyph = close.querySelector('svg.q-icon.q-icon-md')
    expect(glyph).toBeInTheDocument()
  })

  it('renders header start / end flank slots before the close button', () => {
    render(
      <Vault.Root defaultOpen>
        <Vault.Content>
          <Vault.Header title="Filters" start={<button type="button">Back</button>} end={<span data-testid="end" />} />
        </Vault.Content>
      </Vault.Root>,
    )
    const lead = document.querySelector('.q-vault-header-lead') as HTMLElement
    expect(lead).toBeInTheDocument()
    const back = screen.getByRole('button', { name: 'Back' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(lead).toContainElement(back)
    expect(lead).toContainElement(screen.getByText('Filters'))
    expect(lead).toContainElement(screen.getByTestId('end'))
    // close stays after the lead group
    expect(back.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the title-only header bare (no lead wrapper) — back-compat', () => {
    open()
    expect(document.querySelector('.q-vault-header-lead')).toBeNull()
    expect(screen.getByText('Filters')).toHaveClass('q-vault-title')
  })

  it('stretches actions with the full footer prop', () => {
    render(
      <Vault.Root defaultOpen>
        <Vault.Content>
          <Vault.Header title="x" />
          <Vault.Footer full actions={<button type="button">Apply</button>} />
        </Vault.Content>
      </Vault.Root>,
    )
    const actions = screen.getByRole('button', { name: 'Apply' }).closest('.q-vault-actions')
    expect(actions).toHaveClass('q-vault-actions-full')
  })

  it('does not add the full class by default — back-compat', () => {
    render(
      <Vault.Root defaultOpen>
        <Vault.Content>
          <Vault.Header title="x" />
          <Vault.Footer actions={<button type="button">Done</button>} />
        </Vault.Content>
      </Vault.Root>,
    )
    const actions = screen.getByRole('button', { name: 'Done' }).closest('.q-vault-actions')
    expect(actions).not.toHaveClass('q-vault-actions-full')
  })
})
