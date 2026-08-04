import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from './index.ts'

function trackRect(width = 200, left = 0) {
  return {
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + width,
    bottom: 28,
    width,
    height: 28,
    toJSON() {},
  }
}

function mockTrackWidth(el: HTMLElement, width = 200) {
  const rect = trackRect(width)
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
}

describe('<Slider> stepped (default)', () => {
  it('renders the glass track + interior notch ticks + 1 fill bar', () => {
    const { container } = render(<Slider aria-label="x" />)
    const slider = screen.getByRole('slider', { name: 'x' })
    // Glass surface (background-glass + blur + border) lives on the q-slider utility.
    expect(slider).toHaveClass('q-slider', 'h-7', 'rounded-lg', 'overflow-hidden', 'touch-none')
    expect(container.querySelectorAll('[aria-hidden="true"][style*="width"]')).toHaveLength(1)
    // steps=3 default → 1 interior notch tick (endpoints are the track edges).
    expect(container.querySelectorAll('.h-2.w-px')).toHaveLength(1)
  })

  it('notch fill: 0% at start (reachable) → 100% + rounded right at the last step', () => {
    const { container, rerender } = render(<Slider aria-label="x" steps={3} value={0} />)
    let fill = container.querySelector('[style*="width"]') as HTMLElement
    // step 0 is the empty start — not a cumulative 1/N fill.
    expect(fill.style.width).toBe('0%')
    expect(fill).not.toHaveClass('rounded-r-lg')

    rerender(<Slider aria-label="x" steps={3} value={1} />)
    fill = container.querySelector('[style*="width"]') as HTMLElement
    expect(fill.style.width).toBe('50%') // notch 1 of [0, .5, 1]

    rerender(<Slider aria-label="x" steps={3} value={2} />)
    fill = container.querySelector('[style*="width"]') as HTMLElement
    expect(fill.style.width).toBe('100%')
    expect(fill).toHaveClass('rounded-r-lg', 'border-r-0')
  })

  it('interior notch ticks scale with steps (steps-2)', () => {
    const { container } = render(<Slider aria-label="x" steps={5} value={0} />)
    // 5 notches → 3 interior ticks at 25% / 50% / 75%.
    const ticks = container.querySelectorAll('.h-2.w-px')
    expect(ticks).toHaveLength(3)
  })

  it('pointer can reach step 0 (start) by dragging to the far left', () => {
    const onChange = vi.fn()
    render(<Slider aria-label="x" steps={4} defaultValue={3} onChange={onChange} />)
    const track = screen.getByRole('slider')
    mockTrackWidth(track, 300)
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 0, button: 0, pointerType: 'mouse' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('pointer drag snaps to the segment under the pointer', () => {
    const onChange = vi.fn()
    const onChangeEnd = vi.fn()
    render(<Slider aria-label="x" steps={3} defaultValue={2} onChange={onChange} onChangeEnd={onChangeEnd} />)
    const track = screen.getByRole('slider')
    mockTrackWidth(track, 300) // each segment 100 px wide

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 50, button: 0, pointerType: 'mouse' })
    expect(onChange).toHaveBeenLastCalledWith(0)

    fireEvent.pointerMove(track, { pointerId: 1, clientX: 150 })
    expect(onChange).toHaveBeenLastCalledWith(1)

    fireEvent.pointerMove(track, { pointerId: 1, clientX: 290 })
    expect(onChange).toHaveBeenLastCalledWith(2)

    fireEvent.pointerUp(track, { pointerId: 1, clientX: 290 })
    expect(onChangeEnd).toHaveBeenCalledWith(2)
  })

  it('keyboard ←/→/Home/End', () => {
    const onChange = vi.fn()
    render(<Slider aria-label="x" steps={4} defaultValue={1} onChange={onChange} />)
    const slider = screen.getByRole('slider')
    act(() => slider.focus())
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('forwards ref to the root slider node without breaking internal measurement', () => {
    const ref = createRef<HTMLDivElement>()
    const onChange = vi.fn()
    render(<Slider aria-label="x" steps={4} defaultValue={3} onChange={onChange} ref={ref} />)
    const track = screen.getByRole('slider', { name: 'x' })
    expect(ref.current).toBe(track)
    // Internal trackRef still drives pointer math (a caller ref must not clobber it).
    mockTrackWidth(track, 300)
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 0, button: 0, pointerType: 'mouse' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('aria attributes reflect stepped semantics', () => {
    render(<Slider aria-label="x" steps={5} value={2} />)
    const s = screen.getByRole('slider')
    expect(s).toHaveAttribute('aria-valuemin', '0')
    expect(s).toHaveAttribute('aria-valuemax', '4')
    expect(s).toHaveAttribute('aria-valuenow', '2')
  })
})

describe('<Slider> continuous', () => {
  it('renders without ticks by default', () => {
    const { container } = render(<Slider mode="continuous" aria-label="vol" />)
    expect(container.querySelectorAll('.h-2.w-px')).toHaveLength(0)
  })

  it('fill = (value - min) / (max - min)', () => {
    const { container } = render(
      <Slider mode="continuous" aria-label="vol" min={0} max={100} value={25} />,
    )
    const fill = container.querySelector('[style*="width"]') as HTMLElement
    expect(fill.style.width).toBe('25%')
  })

  it('drag produces fractional values (free, step=0)', () => {
    const onChange = vi.fn()
    render(<Slider mode="continuous" aria-label="vol" min={0} max={100} defaultValue={0} onChange={onChange} />)
    const track = screen.getByRole('slider')
    mockTrackWidth(track, 200)

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 50, button: 0, pointerType: 'mouse' })
    // 50 / 200 = 25%
    expect(onChange).toHaveBeenLastCalledWith(25)

    fireEvent.pointerMove(track, { pointerId: 1, clientX: 137 })
    // 137 / 200 = 68.5%
    expect(onChange).toHaveBeenLastCalledWith(68.5)
  })

  it('step snaps to the nearest increment', () => {
    const onChange = vi.fn()
    render(
      <Slider mode="continuous" aria-label="vol" min={0} max={100} step={10} onChange={onChange} />,
    )
    const track = screen.getByRole('slider')
    mockTrackWidth(track, 200)
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 47, button: 0, pointerType: 'mouse' })
    // 47/200 = 23.5 → snap to 20
    expect(onChange).toHaveBeenLastCalledWith(20)
  })

  it('keyboard moves by step (or 1% if free)', () => {
    const onChange = vi.fn()
    render(
      <Slider mode="continuous" aria-label="vol" min={0} max={100} step={5} defaultValue={50} onChange={onChange} />,
    )
    const slider = screen.getByRole('slider')
    act(() => slider.focus())
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(55)
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith(100) // capped
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('honours showTicks + steps for visual marks', () => {
    const { container } = render(
      <Slider mode="continuous" aria-label="vol" min={0} max={100} steps={5} showTicks />,
    )
    expect(container.querySelectorAll('.h-2.w-px')).toHaveLength(5)
  })
})

describe('<Slider> motion + disabled', () => {
  it('drag suspends the width transition; releasing restores it', () => {
    const { container } = render(<Slider aria-label="x" />)
    const track = screen.getByRole('slider')
    mockTrackWidth(track, 300)
    let fill = container.querySelector('[style*="width"]') as HTMLElement
    expect(fill).toHaveClass('transition-[width]', 'duration-200', 'ease-out')

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 50, button: 0, pointerType: 'mouse' })
    fill = container.querySelector('[style*="width"]') as HTMLElement
    expect(fill).toHaveClass('transition-none')

    fireEvent.pointerUp(track, { pointerId: 1, clientX: 50 })
    fill = container.querySelector('[style*="width"]') as HTMLElement
    expect(fill).toHaveClass('transition-[width]')
  })

  it('disabled blocks pointer + keyboard + sets tabIndex -1', () => {
    const onChange = vi.fn()
    render(<Slider aria-label="x" disabled onChange={onChange} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('tabIndex', '-1')
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveClass('pointer-events-none', 'opacity-50')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
