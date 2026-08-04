import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar } from './index.ts'

describe('<Avatar>', () => {
  it('shows initials derived from alt (up to two words)', () => {
    render(<Avatar alt="Aria Zhang" />)
    expect(screen.getByText('AZ')).toBeInTheDocument()
  })

  it('renders the initials through Typography with the matching mono composite', () => {
    render(<Avatar alt="Aria Zhang" size="md" />)
    const initials = screen.getByText('AZ')
    expect(initials.tagName).toBe('SPAN')
    expect(initials).toHaveClass('text-q-mono-lg-semi-bold')
  })

  it('uses the dashed pending type ramp for the placeholder initials', () => {
    render(<Avatar alt="Add" variant="pending" size="md" />)
    // pending md = mono-sm (12px), distinct from the filled md ramp (mono-lg).
    expect(screen.getByText('A')).toHaveClass('text-q-mono-sm-semi-bold')
  })

  it('renders a custom fallback node', () => {
    render(<Avatar fallback={<strong>HF</strong>} />)
    expect(screen.getByText('HF')).toBeInTheDocument()
  })

  it('applies className to the avatar root', () => {
    const { container } = render(<Avatar alt="Aria Zhang" className="custom-avatar" />)
    const root = container.querySelector('.custom-avatar')
    expect(root).not.toBeNull()
    expect(root).toHaveClass('size-q-1000')
  })

  it('renders a labelled status dot', () => {
    render(<Avatar alt="Aria Zhang" status="online" />)
    expect(screen.getByRole('img', { name: 'online' })).toBeInTheDocument()
  })

  it('anchors the status dot on the avatar rim', () => {
    render(<Avatar alt="Aria Zhang" status="online" />)
    expect(screen.getByRole('img', { name: 'online' })).toHaveClass('q-avatar-status')
  })

  it('uses the Figma size ramp for xl avatars', () => {
    const { container } = render(<Avatar alt="Aria Zhang" size="xl" />)
    expect(container.querySelector('.size-q-1400')).not.toBeNull()
  })

  it('uses the Figma mono ramp: 16px for xl, 10px for xxs', () => {
    const xl = render(<Avatar alt="Aria Zhang" size="xl" />)
    expect(xl.container.querySelector('.text-q-mono-lg-semi-bold')).not.toBeNull()
    xl.unmount()
    const xxs = render(<Avatar alt="Aria Zhang" size="xxs" />)
    expect(xxs.container.querySelector('.text-q-mono-xs-semi-bold')).not.toBeNull()
  })

  it('keeps the legacy 2xs alias mapped to the Figma xxs size', () => {
    const { container } = render(<Avatar alt="Aria Zhang" size="2xs" />)
    expect(container.querySelector('.size-q-500')).not.toBeNull()
  })

  it('uses one initial for compact xs and xxs avatars', () => {
    render(<Avatar alt="Aria Zhang" size="xs" />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('AZ')).not.toBeInTheDocument()
  })

  it('scales the online dot to the Figma status size for xl avatars', () => {
    render(<Avatar alt="Aria Zhang" size="xl" status="online" />)
    expect(screen.getByRole('img', { name: 'online' })).toHaveClass('size-q-200')
  })

  it('paints the status dot with the Figma presence color', () => {
    render(<Avatar alt="Aria Zhang" status="away" />)
    expect(screen.getByRole('img', { name: 'away' })).toHaveClass('bg-q-brand-yellow')
  })

  it('paints a colored disk via the matched palette bg + fg tokens', () => {
    const { container } = render(<Avatar alt="Aria Zhang" color="blue" />)
    const disk = container.querySelector('.bg-q-palette-blue-bg')
    expect(disk).not.toBeNull()
    expect(disk).toHaveClass('text-q-palette-blue-text')
  })

  it('gives light disks a dark fg so initials stay legible', () => {
    const { container } = render(<Avatar alt="Dana Kane" color="yellow" />)
    const disk = container.querySelector('.bg-q-brand-yellow')
    expect(disk).toHaveClass('text-q-text-inverse')
  })

  it('auto-derives a stable color from alt when none is given', () => {
    const a = render(<Avatar alt="Sam Park" />)
    const first = a.container.querySelector('[class*="bg-q-"]')?.className
    a.unmount()
    expect(first).toBeTruthy()
    const b = render(<Avatar alt="Sam Park" />)
    expect(b.container.querySelector('[class*="bg-q-"]')?.className).toBe(first)
  })

  it('renders a custom badge in the rim slot, replacing the default status Dot', () => {
    render(<Avatar alt="Aria Zhang" status="online" badge={<span data-testid="count">9+</span>} />)
    const badge = screen.getByTestId('count')
    expect(badge.closest('.q-avatar-status')).not.toBeNull()
    // the custom badge wins — no default presence Dot is rendered
    expect(screen.queryByRole('img', { name: 'online' })).not.toBeInTheDocument()
  })

  it('renders a dashed placeholder with no colored fill', () => {
    const { container } = render(<Avatar variant="pending" alt="Add" />)
    expect(container.querySelector('.border-dashed')).not.toBeNull()
    expect(container.querySelector('.border-q-medium')).not.toBeNull()
    expect(container.querySelector('.border-q-transparent-light-30')).not.toBeNull()
    expect(container.querySelector('svg.q-avatar-dash')).toBeNull()
    expect(container.querySelector('[class*="bg-q-palette-"]')).toBeNull()
  })

  it('treats an image avatar with no explicit color as a neutral surface', () => {
    const { container } = render(<Avatar src="/x.png" alt="Member" />)
    expect(container.querySelector('[class*="bg-q-palette-"]')).toBeNull()
    expect(container.querySelector('.bg-q-background-elevated-start')).not.toBeNull()
  })
})
