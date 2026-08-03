import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tabs } from './index.ts'

describe('<Tabs>', () => {
  it('marks the active tab and renders the animated indicator', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a">Panel A</Tabs.Panel>
        <Tabs.Panel value="b">Panel B</Tabs.Panel>
      </Tabs.Root>,
    )
    const active = screen.getByRole('tab', { name: 'A' })
    const inactive = screen.getByRole('tab', { name: 'B' })

    expect(active).toHaveAttribute('data-active')
    expect(inactive).not.toHaveAttribute('data-active')
    expect(active.className).toContain('q-tabs-tab')
    expect(screen.getByRole('tablist').querySelector('.q-tabs-indicator')).toBeInTheDocument()
  })

  it('applies segmented, surface, and pill variant classes from the root options', () => {
    const { rerender } = render(
      <Tabs.Root variant="segmented" shape="pill" surface="flat" tone="brandSoft" defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )

    const root = screen.getByRole('tablist').parentElement as HTMLElement
    expect(root).toHaveClass('q-tabs-segmented')
    expect(root).toHaveClass('q-tabs-shape-pill')
    expect(root).toHaveClass('q-tabs-surface-flat')
    expect(root).toHaveClass('q-tabs-tone-brand-soft')

    rerender(
      <Tabs.Root variant="pill" defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )

    expect(screen.getByRole('tablist').parentElement as HTMLElement).toHaveClass('q-tabs-pill')
  })

  it('applies the full-width fill class when fullWidth is set', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List fullWidth aria-label="Full width tabs">
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )

    expect(screen.getByRole('tablist', { name: 'Full width tabs' })).toHaveClass('q-tabs-list-fill')
  })

  it('renders canonical start / subtitle / end slots into the tab', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Tab
            value="a"
            start={<span data-testid="lead" />}
            subtitle={<span data-testid="sub" />}
            end={<span data-testid="trail" />}
          >
            Label
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )
    expect(screen.getByTestId('lead').closest('.q-tabs-tab-icon')).toBeInTheDocument()
    expect(screen.getByTestId('sub').closest('.q-tabs-tab-secondary')).toBeInTheDocument()
    expect(screen.getByTestId('trail').closest('.q-tabs-tab-icon')).toBeInTheDocument()
    expect(screen.getByText('Label').closest('.q-tabs-tab-label')).toBeInTheDocument()
  })

  it('keeps the legacy icon / iconEnd / secondaryText aliases (back-compat)', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Tab
            value="a"
            icon={<span data-testid="legacy-lead" />}
            secondaryText={<span data-testid="legacy-sub" />}
            iconEnd={<span data-testid="legacy-trail" />}
          >
            Label
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )
    expect(screen.getByTestId('legacy-lead').closest('.q-tabs-tab-icon')).toBeInTheDocument()
    expect(screen.getByTestId('legacy-sub').closest('.q-tabs-tab-secondary')).toBeInTheDocument()
    expect(screen.getByTestId('legacy-trail').closest('.q-tabs-tab-icon')).toBeInTheDocument()
  })

  it('renders children bare (no slot wrappers) when no slot is passed (back-compat)', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">Plain</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )
    const tab = screen.getByRole('tab', { name: 'Plain' })
    expect(tab.querySelector('.q-tabs-tab-label')).toBeNull()
    expect(tab.querySelector('.q-tabs-tab-content')).toBeInTheDocument()
  })

  it('renders data-driven tabs from the items prop (value wiring, label, slots)', () => {
    render(
      <Tabs.Root defaultValue="b">
        <Tabs.List
          aria-label="Data tabs"
          items={[
            { value: 'a', label: 'Alpha', start: <span data-testid="ia" /> },
            { value: 'b', label: 'Beta' },
          ]}
        />
        <Tabs.Panel value="a">Panel A</Tabs.Panel>
        <Tabs.Panel value="b">Panel B</Tabs.Panel>
      </Tabs.Root>,
    )
    expect(screen.getByRole('tab', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.getByTestId('ia').closest('.q-tabs-tab-icon')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('data-active')
    expect(screen.getByText('Panel B')).toBeInTheDocument()
    expect(screen.queryByText('Panel A')).toBeNull()
  })

  it('shows only the active panel', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a">Panel A</Tabs.Panel>
        <Tabs.Panel value="b">Panel B</Tabs.Panel>
      </Tabs.Root>,
    )
    expect(screen.getByText('Panel A')).toBeInTheDocument()
    expect(screen.queryByText('Panel B')).toBeNull()
  })
})
