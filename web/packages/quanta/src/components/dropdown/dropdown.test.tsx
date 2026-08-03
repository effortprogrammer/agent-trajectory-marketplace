import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { IconFolder1Outlined as FolderIcon } from '@higgsfield-ai/icons/IconFolder1Outlined'
import { describe, expect, it, vi } from 'vitest'
import { NotFound } from '../not-found/index.ts'
import { Dropdown } from './index.ts'

/** Compose a simple title-only row (the pure-composition primitives). */
function Row({
  title,
  indicator,
  ...props
}: { title: string, indicator?: 'check' | 'checkbox' | 'switch' } & Parameters<typeof Dropdown.Item>[0]) {
  return (
    <Dropdown.Item {...props}>
      <Dropdown.ItemContent>
        <Dropdown.ItemTitleRow>
          <Dropdown.ItemTitle>{title}</Dropdown.ItemTitle>
        </Dropdown.ItemTitleRow>
      </Dropdown.ItemContent>
      {props.selectable
        ? <Dropdown.ItemTrailing><Dropdown.ItemIndicator indicator={indicator} /></Dropdown.ItemTrailing>
        : null}
    </Dropdown.Item>
  )
}

function Basic() {
  return (
    <Dropdown.Root defaultOpen>
      <Dropdown.Trigger>Open</Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.Label>Section</Dropdown.Label>
          <Row title="Plain" />
        </Dropdown.Group>
        <Dropdown.Separator />
      </Dropdown.Content>
    </Dropdown.Root>
  )
}

describe('Dropdown containers', () => {
  it('marks the root trigger so open menus can keep the trigger hover treatment', () => {
    render(<Basic />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    expect(trigger).toHaveClass('q-dropdown-trigger')
    expect(trigger).toHaveAttribute('data-open')
    expect(trigger).toHaveAttribute('data-popup-open')
  })

  it('keeps hover-open opt-in so default dropdowns still require click', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row title="Action" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.hover(trigger)
    expect(screen.queryByRole('menuitem', { name: 'Action' })).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Action' })).toBeInTheDocument()
  })

  it('opens from trigger hover when openOnHover is enabled', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root openOnHover>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row title="Action" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.hover(trigger)
    await screen.findByRole('menuitem', { name: 'Action' })
    expect(trigger).toHaveAttribute('data-open')
  })

  it('renders content (defaultOpen) with the dropdown-content class', () => {
    render(<Basic />)
    expect(screen.getByRole('menu')).toHaveClass('q-dropdown-content')
  })

  it('renders a standalone section label', () => {
    render(<Basic />)
    expect(screen.getByText('Section')).toHaveClass('q-menu-group-label')
  })

  it('applies the size preset to the popup', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content size="large"><Row title="X" /></Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menu')).toHaveClass('q-dropdown-content-large')
  })

  it('applies surface and shape presets to the popup', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content surface="solid" shape="panel"><Row title="X" /></Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menu')).toHaveClass('q-dropdown-content-solid', 'q-dropdown-content-panel')
  })
})

describe('Dropdown.Item composition', () => {
  it('is a styled row that renders arbitrary children verbatim', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item value="folder">
            <Dropdown.ItemIcon><FolderIcon /></Dropdown.ItemIcon>
            <Dropdown.ItemContent>
              <Dropdown.ItemTitleRow>
                <Dropdown.ItemTitle>Folder</Dropdown.ItemTitle>
                <Dropdown.ItemMeta>18</Dropdown.ItemMeta>
              </Dropdown.ItemTitleRow>
              <Dropdown.ItemDescription>12 items</Dropdown.ItemDescription>
            </Dropdown.ItemContent>
            <Dropdown.ItemTrailing>meta</Dropdown.ItemTrailing>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const item = screen.getByRole('menuitem', { name: /Folder/ })
    expect(item).toHaveClass('q-menu-item')
    expect(item.querySelector('.q-menu-item-icon')).toBeInTheDocument()
    expect(item.querySelector('.q-menu-item-label')).toBeInTheDocument()
    expect(item.querySelector('.q-dropdown-item-meta')).toHaveTextContent('18')
    expect(item.querySelector('.q-menu-item-description')).toHaveTextContent('12 items')
    expect(item.querySelector('.q-menu-item-trailing')).toHaveTextContent('meta')
  })

  it('renders a rich media row (large variant via composed media tile)', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item value="model">
            <Dropdown.ItemMedia><FolderIcon /></Dropdown.ItemMedia>
            <Dropdown.ItemContent>
              <Dropdown.ItemTitleRow><Dropdown.ItemTitle>Model row</Dropdown.ItemTitle></Dropdown.ItemTitleRow>
              <Dropdown.ItemDescription>Rich subtitle</Dropdown.ItemDescription>
            </Dropdown.ItemContent>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const item = screen.getByRole('menuitem', { name: /Model row/ })
    expect(item.querySelector('.q-dropdown-item-media')).toBeInTheDocument()
  })

  it('closes the menu when a non-selectable item is clicked', async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [open, setOpen] = useState(true)
      return (
        <Dropdown.Root open={open} onOpenChange={setOpen}>
          <Dropdown.Trigger>Open</Dropdown.Trigger>
          <Dropdown.Content><Row title="Action" /></Dropdown.Content>
        </Dropdown.Root>
      )
    }
    render(<Controlled />)
    await user.click(screen.getByRole('menuitem', { name: 'Action' }))
    expect(screen.queryByRole('menuitem', { name: 'Action' })).not.toBeInTheDocument()
  })

  it('fires onSelect for a non-selectable action item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content><Row title="Action" onSelect={onSelect} /></Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Action' }))
    expect(onSelect).toHaveBeenCalled()
  })

  it('marks a disabled item', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content><Row title="Nope" disabled /></Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menuitem', { name: 'Nope' })).toHaveAttribute('data-disabled')
  })
})

describe('Dropdown.Item slot props (ergonomic API)', () => {
  it('builds the row anatomy from start / title / subtitle / end slots', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item start={<FolderIcon />} title="Soul 2.0" subtitle="Ultra-real" end="2,482" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const item = screen.getByRole('menuitem', { name: /Soul 2\.0/ })
    expect(item.querySelector('.q-menu-item-icon')).toBeInTheDocument()
    expect(item.querySelector('.q-menu-item-title')).toHaveTextContent('Soul 2.0')
    expect(item.querySelector('.q-menu-item-description')).toHaveTextContent('Ultra-real')
    expect(item.querySelector('.q-menu-item-trailing')).toHaveTextContent('2,482')
  })

  it('uses the media tile slot for rich rows', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content><Dropdown.Item media={<FolderIcon />} title="Model" /></Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menuitem', { name: /Model/ }).querySelector('.q-dropdown-item-media')).toBeInTheDocument()
  })

  it('auto-renders the indicator for a selectable slot row', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item title="On" selectable checked />
          <Dropdown.Item title="Off" selectable checked={false} />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menuitemcheckbox', { name: /On/ }).querySelector('.q-menu-item-trailing svg')).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Off/ }).querySelector('.q-menu-item-trailing svg')).not.toBeInTheDocument()
  })

  it('renders children verbatim (no slot wrapping) when no slot prop is passed', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item><span data-testid="raw">raw child</span></Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const item = screen.getByRole('menuitem', { name: /raw child/ })
    expect(item.querySelector('[data-testid="raw"]')).toBeInTheDocument()
    expect(item.querySelector('.q-menu-item-label')).not.toBeInTheDocument()
  })
})

describe('Dropdown.Item selectable handles its own state', () => {
  it('toggles internally with NO value and NO handlers (keyed by title)', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content><Dropdown.Item title="Toggle me" selectable /></Dropdown.Content>
      </Dropdown.Root>,
    )
    const item = screen.getByRole('menuitemcheckbox', { name: /Toggle me/ })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)
    expect(screen.getByRole('menuitemcheckbox', { name: /Toggle me/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('notifies via onCheckedChange even without a value', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content><Dropdown.Item title="Notify" selectable onCheckedChange={onCheckedChange} /></Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Notify/ }))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())
  })

  it('keys Root selection off the title when no value is given', async () => {
    const user = userEvent.setup()
    const onSelected = vi.fn()
    render(
      <Dropdown.Root defaultOpen selectionMode="single" onSelected={onSelected}>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item title="Alpha" selectable />
          <Dropdown.Item title="Beta" selectable />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Beta/ }))
    expect(onSelected).toHaveBeenLastCalledWith(['Beta'])
  })
})

describe('Dropdown.Item selection', () => {
  it('selectable + ItemIndicator="checkbox" uses the real Checkbox and stays open on toggle', async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [checked, setChecked] = useState(false)
      return (
        <Dropdown.Root defaultOpen>
          <Dropdown.Trigger>Open</Dropdown.Trigger>
          <Dropdown.Content>
            <Row title="Toggle" selectable indicator="checkbox" checked={checked} onCheckedChange={setChecked} />
          </Dropdown.Content>
        </Dropdown.Root>
      )
    }
    render(<Controlled />)
    const item = screen.getByRole('menuitemcheckbox', { name: /Toggle/ })
    expect(item.querySelector('.q-checkbox')).toBeInTheDocument()
    await user.click(item)
    expect(screen.getByRole('menuitemcheckbox', { name: /Toggle/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('selectable + ItemIndicator="switch" uses the real Switch', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row title="Switch" selectable indicator="switch" checked />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(
      screen.getByRole('menuitemcheckbox', { name: /Switch/ }).querySelector('.q-switch'),
    ).toBeInTheDocument()
  })

  it('default ItemIndicator (check) shows a trailing check only when checked', () => {
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row title="Sel" selectable checked />
          <Row title="Unsel" selectable checked={false} />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menuitemcheckbox', { name: /Sel/ }).querySelector('.q-menu-item-trailing svg')).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Unsel/ }).querySelector('.q-menu-item-trailing svg')).not.toBeInTheDocument()
  })
})

describe('Dropdown Root selection state', () => {
  it('manages selection internally via item value (no per-item state needed)', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row value="a" title="Alpha" selectable indicator="checkbox" />
          <Row value="b" title="Beta" selectable indicator="checkbox" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const alpha = screen.getByRole('menuitemcheckbox', { name: /Alpha/ })
    expect(alpha).toHaveAttribute('aria-checked', 'false')
    await user.click(alpha)
    expect(screen.getByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('seeds from defaultSelected', () => {
    render(
      <Dropdown.Root defaultOpen defaultSelected={['b']}>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row value="a" title="Alpha" selectable />
          <Row value="b" title="Beta" selectable />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    expect(screen.getByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('fires onSelected with the next array on change (subscription)', async () => {
    const user = userEvent.setup()
    const onSelected = vi.fn()
    render(
      <Dropdown.Root defaultOpen onSelected={onSelected}>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row value="a" title="Alpha" selectable />
          <Row value="b" title="Beta" selectable />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Alpha/ }))
    expect(onSelected).toHaveBeenLastCalledWith(['a'])
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Beta/ }))
    expect(onSelected).toHaveBeenLastCalledWith(['a', 'b'])
  })

  it('single selectionMode keeps only one selected', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen selectionMode="single">
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row value="a" title="Alpha" selectable />
          <Row value="b" title="Beta" selectable />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Alpha/ }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Beta/ }))
    expect(screen.getByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('per-item checked overrides Root state', async () => {
    const user = userEvent.setup()
    const onSelected = vi.fn()
    render(
      <Dropdown.Root defaultOpen onSelected={onSelected}>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Row value="a" title="Manual" selectable checked onCheckedChange={() => {}} />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const item = screen.getByRole('menuitemcheckbox', { name: /Manual/ })
    expect(item).toHaveAttribute('aria-checked', 'true')
    await user.click(item)
    expect(onSelected).not.toHaveBeenCalled()
  })
})

describe('Dropdown submenu (Sub / SubTrigger / SubContent)', () => {
  function WithSub({ triggerRef }: { triggerRef?: ReturnType<typeof createRef<HTMLDivElement>> }) {
    return (
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Sub>
            <Dropdown.SubTrigger ref={triggerRef}>
              <Dropdown.ItemContent>
                <Dropdown.ItemTitleRow><Dropdown.ItemTitle>More</Dropdown.ItemTitle></Dropdown.ItemTitleRow>
              </Dropdown.ItemContent>
              <Dropdown.ItemTrailing><Dropdown.ItemSubChevron /></Dropdown.ItemTrailing>
            </Dropdown.SubTrigger>
            <Dropdown.SubContent>
              <Row title="Nested" />
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Dropdown.Content>
      </Dropdown.Root>
    )
  }

  it('renders a submenu trigger with a chevron', () => {
    render(<WithSub />)
    const trigger = screen.getByRole('menuitem', { name: /More/ })
    expect(trigger).toHaveClass('q-menu-item', 'q-dropdown-submenu-trigger')
    expect(trigger.querySelector('.q-menu-item-trailing svg')).toBeInTheDocument()
  })

  it('forwards a ref to the submenu trigger', () => {
    const ref = createRef<HTMLDivElement>()
    render(<WithSub triggerRef={ref} />)
    expect(ref.current).toBe(screen.getByRole('menuitem', { name: /More/ }))
  })

  it('opens the submenu from a click', async () => {
    const user = userEvent.setup()
    render(<WithSub />)
    const trigger = screen.getByRole('menuitem', { name: /More/ })
    await user.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /Nested/ })).toBeInTheDocument()
  })

  it('builds a submenu trigger from slot props (start / title + auto chevron)', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Sub>
            <Dropdown.SubTrigger start={<FolderIcon />} title="Move to" />
            <Dropdown.SubContent><Row title="Inbox" /></Dropdown.SubContent>
          </Dropdown.Sub>
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const trigger = screen.getByRole('menuitem', { name: /Move to/ })
    expect(trigger.querySelector('.q-menu-item-title')).toHaveTextContent('Move to')
    expect(trigger.querySelector('.q-menu-item-trailing svg')).toBeInTheDocument()
    await user.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /Inbox/ })).toBeInTheDocument()
  })
})

describe('Dropdown search (withSearch)', () => {
  it('renders a search box and filters items live', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content withSearch>
          <Row title="Apple" />
          <Row title="Banana" />
          <Row title="Cherry" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    const input = screen.getByPlaceholderText('Search')
    await user.type(input, 'ban')
    expect(screen.getByRole('menuitem', { name: 'Banana' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Apple' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Cherry' })).not.toBeInTheDocument()
  })

  it('hides a group whose items all filter out', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content withSearch>
          <Dropdown.Group>
            <Dropdown.Label>Fruit</Dropdown.Label>
            <Row title="Apple" />
          </Dropdown.Group>
          <Dropdown.Group>
            <Dropdown.Label>Veg</Dropdown.Label>
            <Row title="Carrot" />
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.type(screen.getByPlaceholderText('Search'), 'carrot')
    expect(screen.getByText('Veg')).toBeInTheDocument()
    expect(screen.queryByText('Fruit')).not.toBeInTheDocument()
  })

  it('filters rich items via the explicit value prop', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content withSearch>
          <Dropdown.Item value="seedance">
            <Dropdown.ItemContent><Dropdown.ItemTitleRow><Dropdown.ItemTitle>Seedance 2.0</Dropdown.ItemTitle></Dropdown.ItemTitleRow></Dropdown.ItemContent>
          </Dropdown.Item>
          <Dropdown.Item value="kling">
            <Dropdown.ItemContent><Dropdown.ItemTitleRow><Dropdown.ItemTitle>Kling 3.0</Dropdown.ItemTitle></Dropdown.ItemTitleRow></Dropdown.ItemContent>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.type(screen.getByPlaceholderText('Search'), 'kling')
    expect(screen.getByText('Kling 3.0')).toBeInTheDocument()
    expect(screen.queryByText('Seedance 2.0')).not.toBeInTheDocument()
  })

  it('shows the default NotFound when a search matches nothing', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content withSearch>
          <Row title="Apple" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.type(screen.getByPlaceholderText('Search'), 'zzz')
    expect(screen.queryByRole('menuitem', { name: 'Apple' })).not.toBeInTheDocument()
    expect(screen.getByText('No results found')).toBeInTheDocument()
  })

  it('renders a custom notFound node when provided', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown.Root defaultOpen>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content withSearch notFound={<NotFound title="Nothing here" subtitle="Add a model first" />}>
          <Row title="Apple" />
        </Dropdown.Content>
      </Dropdown.Root>,
    )
    await user.type(screen.getByPlaceholderText('Search'), 'zzz')
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})
