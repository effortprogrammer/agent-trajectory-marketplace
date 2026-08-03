import { createRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '../modal/index.ts'
import type { CommandFilter } from './index.ts'
import { Command } from './index.ts'

function setup(onSelect = vi.fn()) {
  render(
    <Command label="Test menu">
      <Command.Input placeholder="Search" />
      <Command.List>
        <Command.Empty>Nothing found.</Command.Empty>
        <Command.Group heading="Files">
          <Command.Item onSelect={() => onSelect('new')}>
            <Command.ItemContent>
              <Command.ItemTitle>New File</Command.ItemTitle>
              <Command.ItemDescription>Create a blank file</Command.ItemDescription>
            </Command.ItemContent>
          </Command.Item>
          <Command.Item onSelect={() => onSelect('open')}><Command.ItemTitle>Open File</Command.ItemTitle></Command.Item>
        </Command.Group>
        <Command.Group heading="Settings">
          <Command.Item onSelect={() => onSelect('theme')}>
            <Command.ItemTitle>Toggle Theme</Command.ItemTitle>
            <Command.ItemTrailing>⌘T</Command.ItemTrailing>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command>,
  )
  return { onSelect }
}

const item = (label: string) => screen.getByText(label).closest('[data-command-item]')!

describe('<Command>', () => {
  it('renders a combobox and every item', () => {
    setup()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText('New File')).toBeVisible()
    expect(screen.getByText('Toggle Theme')).toBeVisible()
  })

  it('Command.Input composes the shared Input component', () => {
    setup()
    const input = screen.getByRole('combobox')
    expect(input).toHaveClass('q-field-input')
    expect(input.closest('.q-field')).toBeInTheDocument()
    expect(input.closest('.q-field-control')).toBeInTheDocument()
    expect(document.querySelector('.q-command-input')).toBeNull()
  })

  it('Command.Input renders its default search glyph via the Icon component', () => {
    setup()
    const input = screen.getByRole('combobox')
    // The default leading glyph is wrapped in <Icon size="md"> (q-icon-md = 20px),
    // and sits in the Input affix slot.
    const affix = input.closest('.q-field-control')!.querySelector('.q-field-affix')!
    const glyph = affix.querySelector('.q-icon')!
    expect(glyph).toHaveClass('q-icon', 'q-icon-md')
    // NODE-ONLY: the .q-icon class is painted directly on the glyph <svg> — no wrapper.
    expect(glyph.tagName.toLowerCase()).toBe('svg')
  })

  it('forwards a caller ref to the listbox node without dropping the internal ref', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Command label="Ref">
        <Command.Input />
        <Command.List ref={ref}>
          <Command.Item><Command.ItemTitle>One</Command.ItemTitle></Command.Item>
        </Command.List>
      </Command>,
    )
    // Caller ref lands on the listbox root, and internal nav still works
    // (the internal listRef is merged, not overwritten).
    expect(ref.current).toBe(screen.getByRole('listbox'))
    expect(ref.current).toHaveClass('q-command-list')
  })

  it('fuzzy-filters items and hides groups with no matches', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByRole('combobox'), 'theme')
    expect(screen.getByText('Toggle Theme')).toBeVisible()
    expect(item('New File')).not.toBeVisible()
    expect(screen.getByText('Files').closest('[role="group"]')).not.toBeVisible()
  })

  it('shows the empty state when nothing matches', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByRole('combobox'), 'zzzzz')
    expect(screen.getByText('Nothing found.')).toBeInTheDocument()
  })

  it('suppresses the empty state while loading', () => {
    const Palette = ({ loading }: { loading: boolean }) => (
      <Command label="L" loading={loading} defaultValue="zzz">
        <Command.Input />
        <Command.List>
          <Command.Empty>Nothing found.</Command.Empty>
          <Command.Item><Command.ItemTitle>Alpha</Command.ItemTitle></Command.Item>
        </Command.List>
      </Command>
    )
    const { rerender } = render(<Palette loading />)
    expect(screen.queryByText('Nothing found.')).not.toBeInTheDocument()
    rerender(<Palette loading={false} />)
    expect(screen.getByText('Nothing found.')).toBeInTheDocument()
  })

  it('uses a custom filter when provided', async () => {
    const user = userEvent.setup()
    // Prefix match — stricter than the default fuzzy/substring scorer.
    const filter: CommandFilter = (value, search) => (value.toLowerCase().startsWith(search.toLowerCase()) ? 1 : 0)
    render(
      <Command label="F" filter={filter}>
        <Command.Input />
        <Command.List>
          <Command.Item><Command.ItemTitle>Apple</Command.ItemTitle></Command.Item>
          <Command.Item><Command.ItemTitle>Grape</Command.ItemTitle></Command.Item>
        </Command.List>
      </Command>,
    )
    await user.type(screen.getByRole('combobox'), 'ap')
    expect(screen.getByText('Apple')).toBeVisible() // starts with "ap"
    expect(item('Grape')).not.toBeVisible() // default fuzzy matches "ap" in "grApe"; prefix filter does not
  })

  it('highlights the first item and moves with ArrowDown', async () => {
    const user = userEvent.setup()
    setup()
    expect(item('New File')).toHaveAttribute('data-active')
    screen.getByRole('combobox').focus()
    await user.keyboard('{ArrowDown}')
    expect(item('Open File')).toHaveAttribute('data-active')
    expect(item('New File')).not.toHaveAttribute('data-active')
  })

  it('navigates with Ctrl+n / Ctrl+p (vim bindings)', async () => {
    const user = userEvent.setup()
    setup()
    screen.getByRole('combobox').focus()
    await user.keyboard('{Control>}n{/Control}')
    expect(item('Open File')).toHaveAttribute('data-active')
    await user.keyboard('{Control>}p{/Control}')
    expect(item('New File')).toHaveAttribute('data-active')
  })

  it('wraps with loop (default) and stops at the ends when loop is false', async () => {
    const user = userEvent.setup()
    const Palette = ({ loop }: { loop?: boolean }) => (
      <Command label="Loop" loop={loop}>
        <Command.Input />
        <Command.List>
          <Command.Item><Command.ItemTitle>One</Command.ItemTitle></Command.Item>
          <Command.Item><Command.ItemTitle>Two</Command.ItemTitle></Command.Item>
        </Command.List>
      </Command>
    )
    const { rerender } = render(<Palette />)
    screen.getByRole('combobox').focus()
    await user.keyboard('{ArrowUp}') // from first → wraps to last
    expect(item('Two')).toHaveAttribute('data-active')

    rerender(<Palette loop={false} />)
    await user.keyboard('{ArrowDown}') // at last, no loop → stays
    expect(item('Two')).toHaveAttribute('data-active')
  })

  it('composes items from icon / content / title / description / trailing parts', () => {
    render(
      <Command label="Slots">
        <Command.Input />
        <Command.List>
          <Command.Item>
            <Command.ItemIcon><span data-testid="ico" /></Command.ItemIcon>
            <Command.ItemContent>
              <Command.ItemTitle>Deploy</Command.ItemTitle>
              <Command.ItemDescription>ship it</Command.ItemDescription>
            </Command.ItemContent>
            <Command.ItemTrailing>⌘D</Command.ItemTrailing>
          </Command.Item>
        </Command.List>
      </Command>,
    )
    const row = screen.getByText('Deploy').closest('[data-command-item]')!
    expect(screen.getByText('Deploy')).toHaveClass('q-command-item-title')
    expect(screen.getByText('ship it')).toHaveClass('q-command-item-description')
    expect(screen.getByText('⌘D')).toHaveClass('q-command-item-trailing')
    expect(row.querySelector('.q-command-item-icon')).toContainElement(screen.getByTestId('ico'))
    expect(row.querySelector('.q-command-item-content')).toContainElement(screen.getByText('Deploy'))
  })

  it('detail pane reflects the active item and updates on navigation', async () => {
    const user = userEvent.setup()
    render(
      <Command label="Detail">
        <Command.Input />
        <Command.Body>
          <Command.List>
            <Command.Item detail={<p>Alpha details</p>}><Command.ItemTitle>Alpha</Command.ItemTitle></Command.Item>
            <Command.Item detail={<p>Beta details</p>}><Command.ItemTitle>Beta</Command.ItemTitle></Command.Item>
          </Command.List>
          <Command.Detail />
        </Command.Body>
      </Command>,
    )
    expect(await screen.findByText('Alpha details')).toBeInTheDocument()
    screen.getByRole('combobox').focus()
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByText('Beta details')).toBeInTheDocument()
    expect(screen.queryByText('Alpha details')).not.toBeInTheDocument()
  })

  it('renders the two-pane layout: a Workspace list + the self-wrapping Detail pane', async () => {
    render(
      <Command label="Workspace detail">
        <Command.Body>
          <Modal.Workspace padded={false}>
            <Command.Input />
            <Command.List>
              <Command.Item detail={<p>Alpha details</p>}><Command.ItemTitle>Alpha</Command.ItemTitle></Command.Item>
              <Command.Item detail={<p>Beta details</p>}><Command.ItemTitle>Beta</Command.ItemTitle></Command.Item>
            </Command.List>
          </Modal.Workspace>
          {/* Command.Detail self-wraps in a Modal.Workspace — no manual wrapper. */}
          <Command.Detail />
        </Command.Body>
      </Command>,
    )

    // The list Workspace + the Detail's own Workspace = two frosted panes.
    expect(document.querySelectorAll('.q-modal-workspace')).toHaveLength(2)
    expect(screen.getByText('Alpha details').closest('.q-command-detail')).toHaveClass('q-modal-workspace')
    expect(await screen.findByText('Alpha details')).toBeInTheDocument()
  })

  it('hides the detail pane when the active item has no detail', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Command label="Mixed">
        <Command.Input />
        <Command.Body>
          <Command.List>
            <Command.Item detail={<p>Has detail</p>}><Command.ItemTitle>WithDetail</Command.ItemTitle></Command.Item>
            <Command.Item><Command.ItemTitle>Plain</Command.ItemTitle></Command.Item>
          </Command.List>
          <Command.Detail />
        </Command.Body>
      </Command>,
    )
    expect(await screen.findByText('Has detail')).toBeInTheDocument()
    expect(container.querySelector('.q-command-detail')).toBeInTheDocument()
    screen.getByRole('combobox').focus()
    await user.keyboard('{ArrowDown}') // → "Plain" (no detail)
    await waitFor(() => expect(container.querySelector('.q-command-detail')).not.toBeInTheDocument())
  })

  it('footer action label tracks the active item', async () => {
    const user = userEvent.setup()
    render(
      <Command label="Footer label">
        <Command.Input />
        <Command.List>
          <Command.Item action="Run one"><Command.ItemTitle>One</Command.ItemTitle></Command.Item>
          <Command.Item action="Run two"><Command.ItemTitle>Two</Command.ItemTitle></Command.Item>
        </Command.List>
        <Command.Footer><Command.Action fallback="Pick"><span data-testid="kbd">↵</span></Command.Action></Command.Footer>
      </Command>,
    )
    expect(await screen.findByText('Run one')).toBeInTheDocument()
    screen.getByRole('combobox').focus()
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByText('Run two')).toBeInTheDocument()
    expect(screen.queryByText('Run one')).not.toBeInTheDocument()
  })

  it('footer action runs the active item', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <Command label="Footer">
        <Command.Input />
        <Command.List><Command.Item onSelect={onSelect}><Command.ItemTitle>Run</Command.ItemTitle></Command.Item></Command.List>
        <Command.Footer><Command.Action>Go</Command.Action></Command.Footer>
      </Command>,
    )
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('selects via Enter (active item) and via click', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    screen.getByRole('combobox').focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('new')
    await user.click(screen.getByText('Toggle Theme'))
    expect(onSelect).toHaveBeenCalledWith('theme')
  })

  it('Command.Shortcut composes the canonical Kbd (renders a <kbd> pill)', () => {
    render(<Command.Shortcut>⌘K</Command.Shortcut>)
    const k = screen.getByText('⌘K')
    expect(k.tagName).toBe('KBD')
    // the Kbd pill styling (Figma _Shortcut), not the old q-command-shortcut
    expect(k).toHaveClass('rounded-q-100', 'bg-q-overlay-hover', 'text-q-caption-sm-medium')
  })

  it('Command.Dialog composes the shared Modal shell and size presets', () => {
    render(
      <Command.Dialog defaultOpen size="lg" label="Command menu">
        <Command.Input />
        <Command.List>
          <Command.Item><Command.ItemTitle>Open dashboard</Command.ItemTitle></Command.Item>
        </Command.List>
        <Command.Footer
          caption="Footer label"
          actions={<Command.Action fallback="Select"><span>↵</span></Command.Action>}
        />
      </Command.Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Command menu' })
    const input = screen.getByRole('combobox')
    const footerAction = screen.getByRole('button', { name: /select/i })
    expect(dialog).toHaveClass('q-modal', 'q-modal-size-lg')
    expect(document.querySelector('.q-modal-body')).toBeInTheDocument()
    expect(document.querySelector('.q-modal-workspace')).toBeInTheDocument()
    expect(input.closest('.q-modal-header')).toBeInTheDocument()
    expect(input.closest('.q-modal-workspace')).toBeNull()
    expect(screen.getByRole('listbox').closest('.q-modal-workspace')).toBeInTheDocument()
    expect(screen.getByText('Footer label')).toHaveClass('q-modal-caption')
    expect(footerAction.closest('.q-modal-footer')).toBeInTheDocument()
    expect(footerAction.closest('.q-modal-workspace')).toBeNull()
  })
})
