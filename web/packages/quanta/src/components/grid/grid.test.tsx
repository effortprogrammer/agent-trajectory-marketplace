import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Grid } from './index.ts'

describe('<Grid>', () => {
  it('renders the grid track with the base utility class', () => {
    const { container } = render(<Grid>cells</Grid>)
    const root = container.firstElementChild!
    expect(root).toHaveClass('q-grid')
    expect(root.tagName).toBe('DIV')
  })

  it('wires a fixed column count through the --q-grid-cols var (no autofit)', () => {
    const { container } = render(<Grid cols={3}>x</Grid>)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--q-grid-cols')).toBe('3')
    expect(root).not.toHaveClass('q-grid-autofit')
    expect(root).not.toHaveClass('q-grid-autofill')
  })

  it('switches to an auto-fit track and sets --q-grid-min', () => {
    const { container } = render(<Grid cols="auto-fit" minColWidth="16rem">x</Grid>)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('q-grid-autofit')
    expect(root.style.getPropertyValue('--q-grid-min')).toBe('16rem')
    // auto tracks do not pin a fixed column count
    expect(root.style.getPropertyValue('--q-grid-cols')).toBe('')
  })

  it('uses auto-fill when requested', () => {
    const { container } = render(<Grid cols="auto-fill">x</Grid>)
    expect(container.firstElementChild).toHaveClass('q-grid-autofill')
  })

  it('maps gap / flow / align / justify to native tailwind classes', () => {
    const { container } = render(
      <Grid gap={4} flow="dense" align="center" justify="stretch">x</Grid>,
    )
    expect(container.firstElementChild).toHaveClass(
      'gap-4',
      'grid-flow-row-dense',
      'items-center',
      'justify-items-stretch',
    )
  })

  it('lets per-axis gap override the shared gap', () => {
    const { container } = render(<Grid gap={4} gapX={2}>x</Grid>)
    const root = container.firstElementChild!
    expect(root).toHaveClass('gap-x-2', 'gap-y-4')
    expect(root).not.toHaveClass('gap-4')
  })

  it('forwards className (caller wins / last) and native props', () => {
    const { container } = render(<Grid className="extra" data-testid="g" aria-label="gallery">x</Grid>)
    const root = container.firstElementChild!
    expect(root).toHaveClass('q-grid', 'extra')
    expect(root).toHaveAttribute('aria-label', 'gallery')
    expect(root).toHaveAttribute('data-testid', 'g')
  })

  it('forwards ref to the root grid element', () => {
    let node: HTMLDivElement | null = null
    const { container } = render(<Grid ref={(el) => { node = el }}>x</Grid>)
    expect(node).toBe(container.firstElementChild)
    expect(node).toHaveClass('q-grid')
  })

  describe('<Grid.Item>', () => {
    it('renders the cell hook class', () => {
      render(<Grid.Item>cell</Grid.Item>)
      expect(screen.getByText('cell')).toHaveClass('q-grid-item')
    })

    it('applies colSpan / rowSpan / colStart as inline grid placement', () => {
      render(<Grid.Item colSpan={2} rowSpan={3} colStart={1}>cell</Grid.Item>)
      const cell = screen.getByText('cell')
      expect(cell.style.gridColumn).toBe('span 2 / span 2')
      expect(cell.style.gridRow).toBe('span 3 / span 3')
      expect(cell.style.gridColumnStart).toBe('1')
    })

    it('omits placement styles when spans are unset', () => {
      render(<Grid.Item>cell</Grid.Item>)
      const cell = screen.getByText('cell')
      expect(cell.style.gridColumn).toBe('')
      expect(cell.style.gridRow).toBe('')
    })

    it('forwards ref + className on the item', () => {
      let node: HTMLDivElement | null = null
      render(<Grid.Item className="tile" ref={(el) => { node = el }}>cell</Grid.Item>)
      expect(node).not.toBeNull()
      expect(node).toHaveClass('q-grid-item', 'tile')
    })

    it('exposes flipKey as data-flip-key (and omits it when unset)', () => {
      const { rerender } = render(<Grid.Item flipKey="abc">cell</Grid.Item>)
      expect(screen.getByText('cell')).toHaveAttribute('data-flip-key', 'abc')
      rerender(<Grid.Item>cell</Grid.Item>)
      expect(screen.getByText('cell')).not.toHaveAttribute('data-flip-key')
    })
  })

  describe('animate (FLIP)', () => {
    it('renders children and survives a reorder (FLIP no-ops without WAAPI in the test DOM)', () => {
      const { rerender } = render(
        <Grid cols={3} animate data-testid="g">
          <Grid.Item flipKey="a">A</Grid.Item>
          <Grid.Item flipKey="b">B</Grid.Item>
        </Grid>,
      )
      expect(screen.getByText('A')).toHaveAttribute('data-flip-key', 'a')
      rerender(
        <Grid cols={3} animate data-testid="g">
          <Grid.Item flipKey="b">B</Grid.Item>
          <Grid.Item flipKey="a">A</Grid.Item>
        </Grid>,
      )
      expect(screen.getByTestId('g')).toHaveClass('q-grid')
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
    })
  })

  it('composes into a real grid (track + spanning item)', () => {
    render(
      <Grid cols={4} gap={3} data-testid="track">
        <Grid.Item colSpan={2} data-testid="featured">featured</Grid.Item>
        <Grid.Item>a</Grid.Item>
        <Grid.Item>b</Grid.Item>
      </Grid>,
    )
    const track = screen.getByTestId('track')
    expect(track).toHaveClass('q-grid', 'gap-3')
    expect((track as HTMLElement).style.getPropertyValue('--q-grid-cols')).toBe('4')
    expect(screen.getByTestId('featured').style.gridColumn).toBe('span 2 / span 2')
  })
})
