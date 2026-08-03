import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Progress } from './index.ts'

describe('<Progress> bar', () => {
  it('exposes progressbar a11y and reflects value as fill width', () => {
    const { container } = render(<Progress value={40} aria-label="Upload" />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(container.querySelector('.q-progress-fill')).toHaveStyle({ width: '40%' })
  })

  it('is indeterminate (no valuenow, sliding fill) when value is omitted', () => {
    const { container } = render(<Progress aria-label="Loading" />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(container.querySelector('.q-progress-indeterminate')).toBeInTheDocument()
  })

  it('honors max', () => {
    render(<Progress value={3} max={5} aria-label="Steps" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
  })

  it('applies the slot color via --q-tint', () => {
    const { container } = render(<Progress value={50} color="success" aria-label="x" />)
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--q-tint')).not.toBe('')
  })

  it('disables motion with animated={false}', () => {
    render(<Progress value={50} animated={false} aria-label="x" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-static', '')
  })
})

describe('<Progress> line', () => {
  it('renders N segments and fills them sequentially', () => {
    const { container } = render(<Progress variant="line" steps={4} value={60} aria-label="Steps" />)
    const segs = container.querySelectorAll('.q-progress-segment')
    expect(segs).toHaveLength(4)
    // p=0.6, n=4 → fills: 100, 100, 40, 0
    expect(segs[0]).toHaveAttribute('data-state', 'complete')
    expect(segs[1]).toHaveAttribute('data-state', 'complete')
    expect(segs[2]).toHaveAttribute('data-state', 'active')
    expect(segs[3]).toHaveAttribute('data-state', 'pending')
  })
})

describe('<Progress> dots', () => {
  it('renders a row of N dots (no connectors) with the first round(p·n) filled', () => {
    const { container } = render(<Progress variant="dots" steps={10} value={50} aria-label="Steps" />)
    const dots = container.querySelectorAll('.q-progress-dot')
    expect(dots).toHaveLength(10)
    expect(container.querySelectorAll('.q-progress-connector')).toHaveLength(0)
    const complete = [...dots].filter(d => d.getAttribute('data-state') === 'complete')
    expect(complete).toHaveLength(5) // round(0.5 * 10)
    expect(dots[4]).toHaveAttribute('data-state', 'complete')
    expect(dots[5]).toHaveAttribute('data-state', 'pending')
  })

  it('marks all dots complete at 100%', () => {
    const { container } = render(<Progress variant="dots" steps={3} value={100} aria-label="Done" />)
    container.querySelectorAll('.q-progress-dot').forEach(d => expect(d).toHaveAttribute('data-state', 'complete'))
  })
})

describe('<Progress> circular', () => {
  it('renders a ring (track + accent arc) for circular bar with a11y', () => {
    const { container } = render(<Progress shape="circular" value={50} aria-label="Ring" />)
    const root = screen.getByRole('progressbar', { name: 'Ring' })
    expect(root).toHaveClass('q-progress-circular')
    expect(root).toHaveAttribute('aria-valuenow', '50')
    expect(container.querySelector('.q-progress-ring-track')).toBeInTheDocument()
    expect(container.querySelector('.q-progress-ring-arc')).toBeInTheDocument()
  })

  it('spins an indeterminate ring when value is omitted', () => {
    const { container } = render(<Progress shape="circular" aria-label="Loading" />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(container.querySelector('.q-progress-ring-indeterminate')).toBeInTheDocument()
  })

  it('renders N arc segments, the first round(p·n) complete', () => {
    const { container } = render(<Progress shape="circular" variant="line" steps={4} value={50} aria-label="Segs" />)
    const segs = container.querySelectorAll('.q-progress-ring-seg')
    expect(segs).toHaveLength(4)
    expect([...segs].filter(s => s.getAttribute('data-state') === 'complete')).toHaveLength(2)
  })

  it('renders N dots around the ring, the first round(p·n) complete', () => {
    const { container } = render(<Progress shape="circular" variant="dots" steps={8} value={50} aria-label="Dots" />)
    const dots = container.querySelectorAll('.q-progress-ring-dot')
    expect(dots).toHaveLength(8)
    expect([...dots].filter(d => d.getAttribute('data-state') === 'complete')).toHaveLength(4)
  })

  it('renders a center label from children', () => {
    render(<Progress shape="circular" value={62} aria-label="x">62%</Progress>)
    expect(screen.getByText('62%')).toHaveClass('q-progress-center')
  })

  it('applies the requested size class (xxs … lg)', () => {
    render(<Progress shape="circular" size="xxs" value={10} aria-label="tiny" />)
    expect(screen.getByRole('progressbar')).toHaveClass('q-progress-xxs')
  })
})
