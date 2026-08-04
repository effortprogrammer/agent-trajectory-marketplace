import type { ReactNode } from 'react'
import { createRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { NavigationMenu } from './index.ts'

/** Compose a simple panel row (title-only). */
function Row({ title, ...props }: { title: string } & Parameters<typeof NavigationMenu.MenuItem>[0]) {
  return (
    <NavigationMenu.MenuItem {...props}>
      <NavigationMenu.MenuItemContent>
        <NavigationMenu.MenuItemTitleRow>
          <NavigationMenu.MenuItemTitle>{title}</NavigationMenu.MenuItemTitle>
        </NavigationMenu.MenuItemTitleRow>
      </NavigationMenu.MenuItemContent>
    </NavigationMenu.MenuItem>
  )
}

/** Compose a rich (large) panel row with a media tile. */
function MediaRow({ title, subtitle, media, ...props }: { title: string, subtitle?: string, media?: ReactNode } & Parameters<typeof NavigationMenu.MenuItem>[0]) {
  return (
    <NavigationMenu.MenuItem {...props}>
      <NavigationMenu.MenuMedia data-testid="media">{media ?? <span />}</NavigationMenu.MenuMedia>
      <NavigationMenu.MenuItemContent>
        <NavigationMenu.MenuItemTitleRow>
          <NavigationMenu.MenuItemTitle>{title}</NavigationMenu.MenuItemTitle>
        </NavigationMenu.MenuItemTitleRow>
        {subtitle ? <NavigationMenu.MenuItemDescription>{subtitle}</NavigationMenu.MenuItemDescription> : null}
      </NavigationMenu.MenuItemContent>
    </NavigationMenu.MenuItem>
  )
}

function setup() {
  render(
    <NavigationMenu.Root>
      <NavigationMenu.List>
        <NavigationMenu.Item>
          <NavigationMenu.Trigger>Products</NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Menu rows={3}>
              <NavigationMenu.Group>
                <NavigationMenu.GroupLabel>Create</NavigationMenu.GroupLabel>
                <Row title="Image" href="/image" />
                <Row title="Video" href="/video" />
              </NavigationMenu.Group>
              <Row title="Pricing" href="/pricing" />
            </NavigationMenu.Menu>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
        <NavigationMenu.Item>
          <NavigationMenu.Link href="/docs">Docs</NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>
    </NavigationMenu.Root>,
  )
}

describe('<NavigationMenu>', () => {
  it('renders bar triggers and plain links', () => {
    setup()
    expect(screen.getByRole('button', { name: /products/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs')
  })

  it('opens the panel and reveals its (grouped + ungrouped) rows', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /products/i }))
    await waitFor(() => expect(screen.getByText('Image')).toBeInTheDocument())
    expect(screen.getByText('Video')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    expect(screen.getByText('Create')).toHaveClass('q-nav-group-label')
    expect(screen.getByRole('link', { name: /image/i })).toHaveAttribute('href', '/image')
  })

  it('applies the requested row count to the grid', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /products/i }))
    await waitFor(() => expect(document.querySelector('.q-nav-menu-grid')).toBeInTheDocument())
    expect(document.querySelector('.q-nav-menu-grid')).toHaveClass('q-nav-rows-3')
  })

  it('renders Figma-sized column menus with large media rows', async () => {
    const user = userEvent.setup()
    render(
      <NavigationMenu.Root>
        <NavigationMenu.List>
          <NavigationMenu.Item>
            <NavigationMenu.Trigger>Image</NavigationMenu.Trigger>
            <NavigationMenu.Content>
              <NavigationMenu.Menu size="image" layout="columns">
                <NavigationMenu.Group>
                  <NavigationMenu.GroupLabel>Features</NavigationMenu.GroupLabel>
                  <MediaRow title="Create Image" subtitle="AI image generation" href="/image" />
                </NavigationMenu.Group>
              </NavigationMenu.Menu>
            </NavigationMenu.Content>
          </NavigationMenu.Item>
        </NavigationMenu.List>
      </NavigationMenu.Root>,
    )
    await user.click(screen.getByRole('button', { name: /image/i }))
    await waitFor(() => expect(document.querySelector('.q-nav-menu-size-image')).toBeInTheDocument())
    expect(document.querySelector('.q-nav-menu-columns')).toHaveClass('q-nav-rows-2')
    expect(screen.getByRole('link', { name: /create image/i })).toHaveClass('q-nav-menu-item')
    expect(screen.getByTestId('media')).toHaveClass('q-nav-menu-media')
  })

  it('renders custom menu content without the grid wrapper', async () => {
    const user = userEvent.setup()
    render(
      <NavigationMenu.Root>
        <NavigationMenu.List>
          <NavigationMenu.Item>
            <NavigationMenu.Trigger>Custom</NavigationMenu.Trigger>
            <NavigationMenu.Content>
              <NavigationMenu.Menu layout="custom">
                <div data-testid="custom-content">Custom content</div>
                <NavigationMenu.MenuSeparator data-testid="custom-separator" />
              </NavigationMenu.Menu>
            </NavigationMenu.Content>
          </NavigationMenu.Item>
        </NavigationMenu.List>
      </NavigationMenu.Root>,
    )
    await user.click(screen.getByRole('button', { name: /custom/i }))
    await waitFor(() => expect(screen.getByTestId('custom-content')).toBeInTheDocument())
    expect(document.querySelector('.q-nav-menu-layout-custom')).toBeInTheDocument()
    expect(document.querySelector('.q-nav-menu-layout-custom .q-nav-menu-grid')).not.toBeInTheDocument()
    expect(screen.getByTestId('custom-separator')).toHaveClass('q-nav-menu-separator')
  })

  it('can render menu content statically outside a root', () => {
    render(
      <NavigationMenu.Menu standalone size="plugins" layout="columns">
        <NavigationMenu.Group>
          <NavigationMenu.GroupLabel>Adobe Plugins</NavigationMenu.GroupLabel>
          <MediaRow title="Premiere Pro" subtitle="Higgsfield inside Premiere" href="/premiere" interactive={false} />
        </NavigationMenu.Group>
      </NavigationMenu.Menu>,
    )
    expect(screen.getByText('Adobe Plugins')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /premiere pro/i })).toHaveAttribute('href', '/premiere')
    expect(screen.getByTestId('media')).toHaveClass('q-nav-menu-media')
    expect(document.querySelector('.q-nav-menu')).toHaveClass('q-nav-menu-static')
  })

  it('renders logo, an accent link with composed icon/badge, and the actions cluster', () => {
    const { container } = render(
      <NavigationMenu.Root>
        <NavigationMenu.Logo><span data-testid="logo" /></NavigationMenu.Logo>
        <NavigationMenu.List>
          <NavigationMenu.Item>
            <NavigationMenu.Link href="/sc" accent>
              <NavigationMenu.ItemIcon><span data-testid="lead" /></NavigationMenu.ItemIcon>
              Supercomputer
              <span data-testid="badge" />
            </NavigationMenu.Link>
          </NavigationMenu.Item>
        </NavigationMenu.List>
        <NavigationMenu.Actions>
          <NavigationMenu.Action iconOnly aria-label="Search"><span /></NavigationMenu.Action>
          <NavigationMenu.Action href="/pricing">Pricing</NavigationMenu.Action>
        </NavigationMenu.Actions>
      </NavigationMenu.Root>,
    )
    expect(screen.getByTestId('logo').closest('.q-nav-logo')).toBeInTheDocument()
    const sc = screen.getByRole('link', { name: /supercomputer/i })
    expect(sc).toHaveClass('q-nav-item', 'q-nav-item-accent')
    expect(screen.getByTestId('lead').closest('.q-nav-item-icon')).toBeInTheDocument()
    expect(screen.getByTestId('badge')).toBeInTheDocument()
    expect(container.querySelector('.q-nav-actions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toHaveClass('q-nav-action', 'q-nav-action-icon')
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing')
  })

  it('Action defaults to a <button> and renders an <a> from href', () => {
    render(
      <NavigationMenu.Root>
        <NavigationMenu.Actions>
          <NavigationMenu.Action>Plain</NavigationMenu.Action>
          <NavigationMenu.Action href="/go">Linked</NavigationMenu.Action>
        </NavigationMenu.Actions>
      </NavigationMenu.Root>,
    )
    const plain = screen.getByRole('button', { name: 'Plain' })
    expect(plain.tagName).toBe('BUTTON')
    expect(plain).toHaveAttribute('type', 'button')
    expect(plain).toHaveClass('q-nav-action')
    const linked = screen.getByRole('link', { name: 'Linked' })
    expect(linked.tagName).toBe('A')
    expect(linked).toHaveAttribute('href', '/go')
    expect(linked).not.toHaveAttribute('type')
  })

  it('forwards refs to the trigger button and the plain link', () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const linkRef = createRef<HTMLAnchorElement>()
    render(
      <NavigationMenu.Root>
        <NavigationMenu.List>
          <NavigationMenu.Item>
            <NavigationMenu.Trigger ref={triggerRef}>Products</NavigationMenu.Trigger>
            <NavigationMenu.Content>
              <NavigationMenu.Menu><Row title="Image" href="/image" /></NavigationMenu.Menu>
            </NavigationMenu.Content>
          </NavigationMenu.Item>
          <NavigationMenu.Item>
            <NavigationMenu.Link href="/docs" ref={linkRef}>Docs</NavigationMenu.Link>
          </NavigationMenu.Item>
        </NavigationMenu.List>
      </NavigationMenu.Root>,
    )
    expect(triggerRef.current?.tagName).toBe('BUTTON')
    expect(linkRef.current?.tagName).toBe('A')
    expect(linkRef.current).toHaveAttribute('href', '/docs')
  })

  it('marks the current section with active (aria-current=page) on a link and a trigger', () => {
    render(
      <NavigationMenu.Root>
        <NavigationMenu.List>
          <NavigationMenu.Item>
            <NavigationMenu.Link href="/image" active>Image</NavigationMenu.Link>
          </NavigationMenu.Item>
          <NavigationMenu.Item>
            <NavigationMenu.Trigger active>Video</NavigationMenu.Trigger>
            <NavigationMenu.Content><NavigationMenu.Menu><Row title="Create" href="/v" /></NavigationMenu.Menu></NavigationMenu.Content>
          </NavigationMenu.Item>
          <NavigationMenu.Item>
            <NavigationMenu.Link href="/docs">Docs</NavigationMenu.Link>
          </NavigationMenu.Item>
        </NavigationMenu.List>
      </NavigationMenu.Root>,
    )
    expect(screen.getByRole('link', { name: 'Image' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /video/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Docs' })).not.toHaveAttribute('aria-current')
  })

  it('Action swaps its element via render, keeping the pill styling', () => {
    render(
      <NavigationMenu.Root>
        <NavigationMenu.Actions>
          <NavigationMenu.Action render={<a href="/custom" data-testid="custom" />}>Custom</NavigationMenu.Action>
        </NavigationMenu.Actions>
      </NavigationMenu.Root>,
    )
    const custom = screen.getByTestId('custom')
    expect(custom.tagName).toBe('A')
    expect(custom).toHaveAttribute('href', '/custom')
    expect(custom).toHaveClass('q-nav-action')
    expect(custom).not.toHaveAttribute('type')
  })
})
