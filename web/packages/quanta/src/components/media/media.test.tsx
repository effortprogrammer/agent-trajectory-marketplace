import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Media, useMediaFallback } from './index.ts'

describe('Media.Root', () => {
  it('renders a box with the composite class and a default ratio/rounded', () => {
    render(
      <Media data-testid="root">
        <Media.Image src="/x.jpg" alt="x" />
      </Media>,
    )
    const root = screen.getByTestId('root')
    expect(root).toHaveClass('q-media')
    // defaults: ratio="video" → aspect-video, rounded="md" → rounded-q-300
    expect(root).toHaveClass('aspect-video')
    expect(root).toHaveClass('rounded-q-300')
  })

  it('maps preset ratios + rounded tokens to their utilities', () => {
    render(<Media data-testid="root" ratio="portrait" rounded="full" />)
    const root = screen.getByTestId('root')
    expect(root).toHaveClass('q-media-portrait')
    expect(root).toHaveClass('rounded-q-full')
    expect(root).not.toHaveClass('aspect-video')
  })

  it('wires a numeric ratio through the --q-media-ratio var, not a class', () => {
    render(<Media data-testid="root" ratio={4 / 3} />)
    const root = screen.getByTestId('root')
    expect(root).not.toHaveClass('aspect-video')
    expect(root.style.getPropertyValue('--q-media-ratio')).toBe(String(4 / 3))
  })

  it('forwards ref to the root DOM node', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Media ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(ref.current).toHaveClass('q-media')
  })

  it('keeps caller className last so callers win ordering', () => {
    render(<Media data-testid="root" className="custom-x" />)
    const cls = screen.getByTestId('root').className
    expect(cls.trim().endsWith('custom-x')).toBe(true)
  })
})

describe('Media.Image / Media.Video', () => {
  it('renders an img filling the box with object-fit + lazy loading defaults', () => {
    render(<Media.Image src="/photo.jpg" alt="A photo" />)
    const img = screen.getByRole('img', { name: 'A photo' })
    expect(img).toHaveClass('q-media-fill')
    expect(img).toHaveClass('object-cover')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('honors the contain fit', () => {
    render(<Media.Image src="/photo.jpg" alt="A photo" fit="contain" />)
    expect(screen.getByRole('img', { name: 'A photo' })).toHaveClass('object-contain')
  })

  it('renders a video and passes poster/controls through', () => {
    render(<Media.Video data-testid="vid" poster="/poster.jpg" controls muted />)
    const vid = screen.getByTestId('vid')
    expect(vid.tagName).toBe('VIDEO')
    expect(vid).toHaveClass('q-media-fill')
    expect(vid).toHaveAttribute('poster', '/poster.jpg')
  })

  it('autoPlayInView forces muted + lazies preload (autoplay requirements)', () => {
    render(<Media.Video data-testid="vid" src="/clip.mp4" autoPlayInView loop />)
    const vid = screen.getByTestId('vid') as HTMLVideoElement
    expect(vid.muted).toBe(true)
    expect(vid).toHaveAttribute('preload', 'metadata')
    expect(vid).toHaveAttribute('loop')
  })

  it('leaves preload unset for a normal (non-autoplay) video', () => {
    render(<Media.Video data-testid="vid" src="/clip.mp4" />)
    expect(screen.getByTestId('vid')).not.toHaveAttribute('preload')
  })
})

describe('Media.Overlay / Media.Fallback / Media.Caption', () => {
  it('places the overlay via the placement utility', () => {
    render(<Media.Overlay data-testid="ov" placement="bottom">scrim</Media.Overlay>)
    const ov = screen.getByTestId('ov')
    expect(ov).toHaveClass('q-media-overlay')
    expect(ov).toHaveClass('q-media-overlay-bottom')
  })

  it('renders fallback content', () => {
    render(<Media.Fallback>No image</Media.Fallback>)
    expect(screen.getByText('No image')).toHaveClass('q-media-fallback')
  })

  it('renders a caption', () => {
    render(<Media.Caption>Sunset</Media.Caption>)
    expect(screen.getByText('Sunset')).toHaveClass('q-media-caption')
  })
})

describe('useMediaFallback (broken-source flow)', () => {
  function BrokenImage() {
    const { failed, onError } = useMediaFallback()
    return (
      <Media>
        {failed
          ? <Media.Fallback>Broken</Media.Fallback>
          : <Media.Image src="/missing.jpg" alt="thing" onError={onError} />}
      </Media>
    )
  }

  it('flips to the fallback when the image errors (mirrors Avatar onError)', () => {
    render(<BrokenImage />)
    const img = screen.getByRole('img', { name: 'thing' })
    expect(screen.queryByText('Broken')).toBeNull()
    fireEvent.error(img)
    expect(screen.getByText('Broken')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'thing' })).toBeNull()
  })
})
