import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { IconPlusMediumOutlined as PlusIcon } from '@higgsfield-ai/icons/IconPlusMediumOutlined'
import { describe, expect, it } from 'vitest'
import { Button, button } from './index.ts'

describe('button() class-builder', () => {
  it('defaults to primary + sm', () => {
    expect(button()).toBe('q-button q-button-primary q-button-sm')
  })
  it('applies variant + size', () => {
    expect(button({ variant: 'danger', size: 'lg' })).toBe('q-button q-button-danger q-button-lg')
  })
  it('adds icon-only and extra classes, dropping falsy', () => {
    expect(button({ iconOnly: true }, 'w-full', false)).toBe(
      'q-button q-button-primary q-button-sm q-button-icon-only w-full',
    )
  })
  it('kebab-cases camelCase variants (dangerSoft → danger-soft)', () => {
    expect(button({ variant: 'dangerSoft' })).toBe('q-button q-button-danger-soft q-button-sm')
  })
  it('includes marketing variants and the lg size', () => {
    expect(button({ variant: 'marketingPrimary', size: 'lg' })).toBe(
      'q-button q-button-marketing-primary q-button-lg',
    )
  })
  it('clamps marketing primary/secondary xxs up to xs', () => {
    expect(button({ variant: 'marketingPrimary', size: 'xxs' })).toBe(
      'q-button q-button-marketing-primary q-button-xs',
    )
    expect(button({ variant: 'marketingSecondary', size: 'xxs' })).toBe(
      'q-button q-button-marketing-secondary q-button-xs',
    )
  })
  it('keeps xxs for default and marketing glass variants', () => {
    expect(button({ variant: 'primary', size: 'xxs' })).toBe(
      'q-button q-button-primary q-button-xxs',
    )
    expect(button({ variant: 'marketingTertiary', size: 'xxs' })).toBe(
      'q-button q-button-marketing-tertiary q-button-xxs',
    )
    expect(button({ variant: 'marketingGhost', size: 'xxs' })).toBe(
      'q-button q-button-marketing-ghost q-button-xxs',
    )
  })
  it('includes special variants', () => {
    expect(button({ variant: 'specialPink' })).toBe(
      'q-button q-button-special-pink q-button-sm',
    )
  })
})

describe('<Button>', () => {
  it('renders a <button type="button"> with the classes', () => {
    render(<Button variant="secondary" size="sm">Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveClass('q-button', 'q-button-secondary', 'q-button-sm')
  })
  it('merges caller className and forwards native props', () => {
    render(<Button className="w-full" disabled>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toHaveClass('q-button', 'w-full')
    expect(btn).toBeDisabled()
  })
  it('renders as a link via `as` (no type attribute)', () => {
    render(<Button as="a" href="/go" variant="ghost">Go</Button>)
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/go')
    expect(link).not.toHaveAttribute('type')
    expect(link).toHaveClass('q-button', 'q-button-ghost')
  })
  it('applies icon-only', () => {
    render(<Button iconOnly aria-label="Add"><PlusIcon /></Button>)
    expect(screen.getByRole('button', { name: 'Add' })).toHaveClass('q-button-icon-only')
  })
  it('renders marketing variants', () => {
    render(<Button variant="marketingTertiary" size="lg">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass(
      'q-button',
      'q-button-marketing-tertiary',
      'q-button-lg',
    )
  })
  it('renders special variants', () => {
    render(<Button variant="specialBrand">Generate</Button>)
    expect(screen.getByRole('button', { name: 'Generate' })).toHaveClass(
      'q-button',
      'q-button-special-brand',
      'q-button-sm',
    )
  })
  it('composes start / end slots around the label, in order', () => {
    render(
      <Button start={<PlusIcon data-testid="lead" />} end={<span data-testid="trail">⌘K</span>}>
        Search
      </Button>,
    )
    const btn = screen.getByRole('button', { name: /search/i })
    expect(btn).toHaveTextContent('Search')
    expect(screen.getByTestId('lead')).toBeInTheDocument()
    expect(screen.getByTestId('trail')).toBeInTheDocument()
    expect(btn.querySelector('.q-button-label-frame')).toHaveTextContent('Search')
    // start precedes the label which precedes end
    const order = btn.textContent ?? ''
    expect(btn.querySelector('[data-testid="trail"]')).toBeInTheDocument()
    expect(order.indexOf('Search')).toBeGreaterThanOrEqual(0)
  })
  it('renders only the label when no slots are passed (back-compat)', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Save')
  })
  it('lets the caller override the default type', () => {
    render(<Button type="submit">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit')
  })
  it('forwards a ref to the underlying button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Go</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
  it('forwards a ref to the polymorphic element', () => {
    const ref = createRef<HTMLAnchorElement>()
    render(<Button as="a" href="/go" ref={ref}>Go</Button>)
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement)
  })
})

describe('<Button asChild>', () => {
  it('merges styling onto the child without adding a wrapper', () => {
    render(
      <Button asChild variant="ghost" size="sm">
        <a href="/go">Go</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/go')
    expect(link).toHaveClass('q-button', 'q-button-ghost', 'q-button-sm')
    // no implicit type="button" leaks onto a non-button child
    expect(link).not.toHaveAttribute('type')
    // Slot renders the child in place — no surrounding <button>
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('forwards a ref through the slot to the child', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button asChild ref={ref}>
        <button>Go</button>
      </Button>,
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
