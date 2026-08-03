import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './index.ts'

/** Compose a label-only row. */
function Row({ label, ...props }: { label: string } & Parameters<typeof Sidebar.Item>[0]) {
  return (
    <Sidebar.Item {...props}>
      <Sidebar.ItemLabel>{label}</Sidebar.ItemLabel>
    </Sidebar.Item>
  )
}

describe('<Sidebar>', () => {
  it('renders the rail with header, body sections and footer', () => {
    const { container } = render(
      <Sidebar.Root aria-label="Main">
        <Sidebar.Header>
          <Sidebar.Switcher>
            <Sidebar.Title>Cinema Studio <Sidebar.SwitcherChevron /></Sidebar.Title>
          </Sidebar.Switcher>
        </Sidebar.Header>
        <Sidebar.Body>
          <Sidebar.Section>
            <Sidebar.SectionItems>
              <Row label="Home" selected />
            </Sidebar.SectionItems>
          </Sidebar.Section>
        </Sidebar.Body>
        <Sidebar.Footer>
          <Sidebar.FooterItem variant="login"><Sidebar.ItemLabel>Login</Sidebar.ItemLabel></Sidebar.FooterItem>
        </Sidebar.Footer>
      </Sidebar.Root>,
    )
    expect(container.querySelector('.q-sidebar')).toBeInTheDocument()
    expect(screen.getByText('Cinema Studio')).toHaveClass('q-sidebar-switcher-name')
    expect(container.querySelector('.q-sidebar-body')).toBeInTheDocument()
    expect(container.querySelector('.q-sidebar-footer')).toBeInTheDocument()
  })

  it('carries the composite type utilities on the row parts (token adoption)', () => {
    render(
      <Sidebar.Section>
        <Sidebar.SectionHeader><Sidebar.SectionTitle>Projects</Sidebar.SectionTitle></Sidebar.SectionHeader>
        <Sidebar.SectionItems>
          <Sidebar.Item>
            <Sidebar.ItemLabel>Blue Horizon</Sidebar.ItemLabel>
            <Sidebar.ItemMeta>484</Sidebar.ItemMeta>
          </Sidebar.Item>
        </Sidebar.SectionItems>
      </Sidebar.Section>,
    )
    expect(screen.getByText('Projects')).toHaveClass('q-sidebar-section-title', 'text-q-label-xs-medium')
    expect(screen.getByText('Blue Horizon')).toHaveClass('q-sidebar-label', 'text-q-body-sm-medium')
    expect(screen.getByText('484')).toHaveClass('q-sidebar-meta', 'text-q-caption-sm-regular')
  })

  it('renders the switcher chevron through Icon (token-sized, decorative)', () => {
    const { container } = render(<Sidebar.SwitcherChevron />)
    const chevron = container.querySelector('.q-sidebar-switcher-chevron')
    expect(chevron).toHaveClass('q-icon', 'q-icon-sm')
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the default search glyph through Icon (token-sized)', () => {
    const { container } = render(<Sidebar.Search />)
    expect(container.querySelector('.q-sidebar-search-icon')).toHaveClass('q-icon', 'q-icon-lg')
  })

  it('marks the selected item with the selected class + aria-current', () => {
    render(<Row label="Home" selected />)
    const item = screen.getByRole('button', { name: 'Home' })
    expect(item).toHaveClass('q-sidebar-row', 'q-sidebar-item', 'q-sidebar-selected')
    expect(item).toHaveAttribute('aria-current', 'page')
  })

  it('renders an Item as a link when href is set', () => {
    render(<Row label="Home" href="/home" />)
    const link = screen.getByRole('link', { name: 'Home' })
    expect(link).toHaveAttribute('href', '/home')
    expect(link).toHaveClass('q-sidebar-item')
  })

  it('applies the sm size class', () => {
    render(<Row label="Chat" size="sm" />)
    expect(screen.getByRole('button')).toHaveClass('q-sidebar-item-sm')
  })

  it('composes icon, label, meta and end in order, host swappable via render', () => {
    render(
      <Sidebar.Item render={<a href="/x" data-testid="link" />}>
        <Sidebar.ItemIcon><span data-testid="s" /></Sidebar.ItemIcon>
        <Sidebar.ItemLabel>Item</Sidebar.ItemLabel>
        <Sidebar.ItemMeta>9</Sidebar.ItemMeta>
        <Sidebar.ItemEnd><span data-testid="e" /></Sidebar.ItemEnd>
      </Sidebar.Item>,
    )
    const root = screen.getByTestId('link')
    expect(root.tagName).toBe('A')
    expect(root).toHaveClass('q-sidebar-item')
    expect(screen.getByTestId('s').closest('.q-sidebar-icon')).toBeInTheDocument()
    const s = screen.getByTestId('s'); const e = screen.getByTestId('e')
    expect(s.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no pin button without onPinChange', () => {
    render(<Row label="Plain" />)
    expect(document.querySelector('.q-sidebar-pinrow')).toBeNull()
    expect(screen.queryByRole('button', { name: /pin/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveClass('q-sidebar-item')
  })

  it('renders a pin toggle as a sibling (not nested) and fires onPinChange', async () => {
    const user = userEvent.setup()
    const onPinChange = vi.fn()
    render(<Row label="Project" onPinChange={onPinChange} />)
    const row = screen.getByRole('button', { name: 'Project' })
    const pin = screen.getByRole('button', { name: 'Pin' })
    expect(row).not.toContainElement(pin)
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    await user.click(pin)
    expect(onPinChange).toHaveBeenCalledWith(true)
  })

  it('renders a row action as a sibling overlay', () => {
    render(<Row label="Project" action={<button type="button">Actions</button>} />)
    const row = screen.getByRole('button', { name: 'Project' })
    const action = screen.getByRole('button', { name: 'Actions' })
    expect(row).not.toContainElement(action)
    expect(action.closest('.q-sidebar-action')).toBeInTheDocument()
    expect(action.closest('.q-sidebar-actionrow')).toBeInTheDocument()
  })

  it('reflects the pinned state (filled, unpin label, aria-pressed)', () => {
    render(<Row label="Project" pinned onPinChange={vi.fn()} />)
    const pin = screen.getByRole('button', { name: 'Unpin' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(pin).toHaveAttribute('data-pinned')
    expect(pin.closest('.q-sidebar-pinrow')).toHaveClass('q-sidebar-pinned')
  })

  it('applies footer variant classes (promo / login)', () => {
    const { rerender } = render(<Sidebar.FooterItem variant="promo"><Sidebar.ItemLabel>Pricing</Sidebar.ItemLabel></Sidebar.FooterItem>)
    expect(screen.getByRole('button')).toHaveClass('q-sidebar-footeritem-promo')
    rerender(<Sidebar.FooterItem variant="login"><Sidebar.ItemLabel>Login</Sidebar.ItemLabel></Sidebar.FooterItem>)
    expect(screen.getByRole('button')).toHaveClass('q-sidebar-footeritem-login')
  })

  it('renders a section header from SectionTitle + SectionActions', () => {
    const { container } = render(
      <Sidebar.Section>
        <Sidebar.SectionHeader>
          <Sidebar.SectionTitle>Projects</Sidebar.SectionTitle>
          <Sidebar.SectionActions><span data-testid="add" /></Sidebar.SectionActions>
        </Sidebar.SectionHeader>
        <Sidebar.SectionItems><Row label="Alpha" /></Sidebar.SectionItems>
      </Sidebar.Section>,
    )
    expect(screen.getByText('Projects')).toHaveClass('q-sidebar-section-title')
    expect(container.querySelector('.q-sidebar-section-actions')).toContainElement(screen.getByTestId('add'))
  })

  it('renders the header switcher + a trailing toggle', () => {
    render(
      <Sidebar.Header>
        <Sidebar.Switcher><Sidebar.Title>WS</Sidebar.Title></Sidebar.Switcher>
        <Sidebar.Toggle>Collapse</Sidebar.Toggle>
      </Sidebar.Header>,
    )
    expect(screen.getByText('WS')).toHaveClass('q-sidebar-switcher-name')
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveClass('q-sidebar-toggle')
  })

  it('collapses to an icon strip', () => {
    const { container } = render(
      <Sidebar.Root collapsed>
        <Sidebar.Body><Row label="Home" /></Sidebar.Body>
      </Sidebar.Root>,
    )
    const root = container.querySelector('.q-sidebar')!
    expect(root).toHaveClass('q-sidebar-collapsed')
    expect(root).toHaveAttribute('data-collapsed', '')
  })

  it('uses defaultCollapsed for the initial uncontrolled state', () => {
    const { container } = render(
      <Sidebar.Root defaultCollapsed aria-label="Main"><Sidebar.Body /></Sidebar.Root>,
    )
    expect(container.querySelector('.q-sidebar')).toHaveClass('q-sidebar-collapsed')
  })

  it('Toggle flips the uncontrolled rail and reflects aria-expanded + default label', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Sidebar.Root aria-label="Main">
        <Sidebar.Header><Sidebar.Toggle><span data-testid="glyph" /></Sidebar.Toggle></Sidebar.Header>
      </Sidebar.Root>,
    )
    const root = container.querySelector('.q-sidebar')!
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(root).not.toHaveClass('q-sidebar-collapsed')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(root).toHaveClass('q-sidebar-collapsed')
    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
  })

  it('fires onCollapsedChange and stays put while collapse is controlled', async () => {
    const user = userEvent.setup()
    const onCollapsedChange = vi.fn()
    const { container } = render(
      <Sidebar.Root collapsed onCollapsedChange={onCollapsedChange} aria-label="Main">
        <Sidebar.Header><Sidebar.Toggle><span /></Sidebar.Toggle></Sidebar.Header>
      </Sidebar.Root>,
    )
    const root = container.querySelector('.q-sidebar')!
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
    expect(root).toHaveClass('q-sidebar-collapsed') // unchanged until the parent flips `collapsed`
  })

  it('lets a custom Toggle onClick suppress the collapse via preventDefault', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const { container } = render(
      <Sidebar.Root aria-label="Main">
        <Sidebar.Toggle onClick={onClick}><span /></Sidebar.Toggle>
      </Sidebar.Root>,
    )
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(onClick).toHaveBeenCalled()
    expect(container.querySelector('.q-sidebar')).not.toHaveClass('q-sidebar-collapsed')
  })

  it('keeps a text-labelled Toggle name and no aria-expanded outside a Root', () => {
    render(<Sidebar.Toggle>Collapse</Sidebar.Toggle>)
    const toggle = screen.getByRole('button', { name: 'Collapse' })
    expect(toggle).not.toHaveAttribute('aria-expanded')
  })

  it('expands a collapsed rail when the switcher is clicked, but not when expanded', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { container } = render(
      <Sidebar.Root defaultCollapsed aria-label="Main">
        <Sidebar.Header>
          <Sidebar.Switcher onClick={onClick}><Sidebar.Logo><span /></Sidebar.Logo></Sidebar.Switcher>
        </Sidebar.Header>
      </Sidebar.Root>,
    )
    const root = container.querySelector('.q-sidebar')!
    const switcher = container.querySelector('.q-sidebar-switcher')!
    expect(root).toHaveClass('q-sidebar-collapsed')
    await user.click(switcher)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(root).not.toHaveClass('q-sidebar-collapsed') // expanded
    // Expanded: clicking the switcher does not collapse (workspace-switch role intact).
    await user.click(switcher)
    expect(root).not.toHaveClass('q-sidebar-collapsed')
  })

  it('builds an Item row from start / title / meta / end slots', () => {
    render(<Sidebar.Item start={<span data-testid="i" />} title="Home" meta="9" end={<span data-testid="e" />} />)
    const row = screen.getByRole('button', { name: /Home/ })
    expect(row.querySelector('.q-sidebar-icon')).toContainElement(screen.getByTestId('i'))
    expect(row.querySelector('.q-sidebar-label')).toHaveTextContent('Home')
    expect(row.querySelector('.q-sidebar-meta')).toHaveTextContent('9')
    expect(row.querySelector('.q-sidebar-end')).toContainElement(screen.getByTestId('e'))
  })

  it('builds a FooterItem from slots', () => {
    render(<Sidebar.FooterItem variant="promo" start={<span data-testid="d" />} title="Pricing" end={<Sidebar.PromoBadge />} />)
    const row = screen.getByRole('button', { name: /Pricing/ })
    expect(row).toHaveClass('q-sidebar-footeritem-promo')
    expect(row.querySelector('.q-sidebar-label')).toHaveTextContent('Pricing')
    expect(row.querySelector('.q-sidebar-promo-badge')).toBeInTheDocument()
  })

  it('renders children verbatim when no slot prop is passed (back-compat)', () => {
    render(<Sidebar.Item><span data-testid="raw">raw</span></Sidebar.Item>)
    const row = screen.getByRole('button', { name: /raw/ })
    expect(row.querySelector('[data-testid="raw"]')).toBeInTheDocument()
    expect(row.querySelector('.q-sidebar-label')).not.toBeInTheDocument()
  })

  it('self-manages the pin when uncontrolled (onPinChange only)', async () => {
    const user = userEvent.setup()
    const onPinChange = vi.fn()
    render(<Sidebar.Item title="Project" onPinChange={onPinChange} />)
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Pin' }))
    expect(onPinChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Unpin' })).toHaveAttribute('aria-pressed', 'true')
  })
})
