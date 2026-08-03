import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VirtualGrid } from './index.ts'

interface Photo { id: number, label: string }
const ITEMS: Photo[] = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `item-${i}` }))

function renderCell(p: Photo) {
  return <span data-testid="cell">{p.label}</span>
}

describe('<VirtualGrid>', () => {
  it('renders the viewport, the full-height sizer, and the grid track', () => {
    const { container } = render(
      <VirtualGrid items={ITEMS} cols={2} rowHeight={100} getKey={p => p.id} renderItem={renderCell} />,
    )
    expect(container.querySelector('.q-virtual-grid')).not.toBeNull()
    const sizer = container.querySelector('.q-virtual-grid-sizer') as HTMLElement
    expect(sizer).not.toBeNull()
    // 100 items / 2 cols = 50 rows → the sizer reserves the full scroll height.
    expect(Number.parseInt(sizer.style.height, 10)).toBeGreaterThan(1000)
    expect(container.querySelector('.q-grid.q-virtual-grid-track')).not.toBeNull()
  })

  it('mounts only a windowed subset, not the whole list', () => {
    render(<VirtualGrid items={ITEMS} cols={2} rowHeight={100} getKey={p => p.id} renderItem={renderCell} />)
    const cells = screen.getAllByTestId('cell')
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.length).toBeLessThan(ITEMS.length)
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.queryByText('item-99')).not.toBeInTheDocument()
  })

  it('pins the fixed column count and the uniform row height on the track', () => {
    const { container } = render(
      <VirtualGrid items={ITEMS} cols={3} rowHeight={120} renderItem={renderCell} />,
    )
    const track = container.querySelector('.q-virtual-grid-track') as HTMLElement
    expect(track.style.getPropertyValue('--q-grid-cols')).toBe('3')
    expect(track.style.gridAutoRows).toBe('120px')
  })

  it('wraps each visible item in a q-grid-item and applies the gap class', () => {
    const { container } = render(
      <VirtualGrid items={ITEMS.slice(0, 6)} cols={2} rowHeight={100} gap={6} renderItem={renderCell} />,
    )
    expect(container.querySelectorAll('.q-grid-item').length).toBeGreaterThan(0)
    expect(container.querySelector('.q-virtual-grid-track')).toHaveClass('gap-6')
  })

  it('falls back to the index key without getKey', () => {
    render(<VirtualGrid items={ITEMS.slice(0, 3)} cols={1} rowHeight={80} renderItem={renderCell} />)
    expect(screen.getByText('item-0')).toBeInTheDocument()
  })

  it('passes an isScrolling meta to renderItem (false at rest, so content loads)', () => {
    const seen: boolean[] = []
    render(
      <VirtualGrid
        items={ITEMS.slice(0, 4)}
        cols={2}
        rowHeight={100}
        renderItem={(p, _i, meta) => {
          seen.push(meta.isScrolling)
          return <span data-testid="cell">{p.label}</span>
        }}
      />,
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(v => v === false)).toBe(true)
  })

  it('calls onEndReached from the scroll viewport once per item count', () => {
    const onEndReached = vi.fn()
    const renderGrid = (items: Photo[]) => (
      <VirtualGrid
        items={items}
        cols={2}
        rowHeight={100}
        endReachedThresholdPx={100}
        onEndReached={onEndReached}
        renderItem={renderCell}
      />
    )
    const { container, rerender } = render(renderGrid(ITEMS.slice(0, 4)))
    const viewport = container.querySelector('.q-virtual-grid') as HTMLElement

    // A short initial list fills itself once; repeated scroll events do not
    // duplicate the same page request.
    expect(onEndReached).toHaveBeenCalledOnce()
    fireEvent.scroll(viewport)
    fireEvent.scroll(viewport)
    expect(onEndReached).toHaveBeenCalledOnce()

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    rerender(renderGrid(ITEMS.slice(0, 6)))
    expect(onEndReached).toHaveBeenCalledOnce()

    viewport.scrollTop = 699
    fireEvent.scroll(viewport)
    expect(onEndReached).toHaveBeenCalledOnce()
    viewport.scrollTop = 700
    fireEvent.scroll(viewport)
    fireEvent.scroll(viewport)
    expect(onEndReached).toHaveBeenCalledTimes(2)
  })
})
