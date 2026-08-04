import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from '../button/index.ts'
import { ButtonGroup, buttonGroup } from './index.ts'

describe('ButtonGroup', () => {
  it('renders a role="group" with the composite class and its buttons', () => {
    render(
      <ButtonGroup aria-label="Text style">
        <Button>Bold</Button>
        <Button>Italic</Button>
      </ButtonGroup>,
    )
    const group = screen.getByRole('group', { name: 'Text style' })
    expect(group).toHaveClass('q-button-group')
    expect(group.querySelectorAll('.q-button')).toHaveLength(2)
  })

  it('defaults to attached + horizontal', () => {
    render(<ButtonGroup><Button>One</Button></ButtonGroup>)
    const group = screen.getByRole('group')
    expect(group).toHaveClass('q-button-group-attached', 'q-button-group-horizontal')
    expect(group).not.toHaveClass('q-button-group-spaced')
  })

  it('renders the spaced shape when attached={false}', () => {
    render(<ButtonGroup attached={false}><Button>One</Button></ButtonGroup>)
    const group = screen.getByRole('group')
    expect(group).toHaveClass('q-button-group-spaced')
    expect(group).not.toHaveClass('q-button-group-attached')
  })

  it('applies the vertical orientation class', () => {
    render(<ButtonGroup orientation="vertical"><Button>One</Button></ButtonGroup>)
    expect(screen.getByRole('group')).toHaveClass('q-button-group-vertical')
  })

  it('propagates size + variant to child Buttons', () => {
    render(
      <ButtonGroup size="sm" variant="outline">
        <Button>A</Button>
        <Button>B</Button>
      </ButtonGroup>,
    )
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toHaveClass('q-button-sm', 'q-button-outline')
    }
  })

  it("does not override a child's own size/variant", () => {
    render(
      <ButtonGroup size="sm" variant="outline">
        <Button>Shared</Button>
        <Button size="lg" variant="primary">Own</Button>
      </ButtonGroup>,
    )
    const own = screen.getByRole('button', { name: 'Own' })
    expect(own).toHaveClass('q-button-lg', 'q-button-primary')
    expect(own).not.toHaveClass('q-button-sm', 'q-button-outline')
  })

  it('leaves children untouched when no shared size/variant is set', () => {
    render(
      <ButtonGroup>
        <Button variant="ghost">Ghost</Button>
      </ButtonGroup>,
    )
    expect(screen.getByRole('button', { name: 'Ghost' })).toHaveClass('q-button-ghost')
  })

  it('forwards ref + extra props to the group div', () => {
    const ref = createRef<HTMLDivElement>()
    render(<ButtonGroup ref={ref} data-testid="grp"><Button>One</Button></ButtonGroup>)
    expect(ref.current).toBe(screen.getByTestId('grp'))
    expect(ref.current).toHaveAttribute('role', 'group')
  })

  it('lets the caller className win (appended last)', () => {
    render(<ButtonGroup className="custom-x"><Button>One</Button></ButtonGroup>)
    expect(screen.getByRole('group')).toHaveClass('q-button-group', 'custom-x')
  })

  it('buttonGroup() recipe emits the same class string', () => {
    expect(buttonGroup()).toBe('q-button-group q-button-group-horizontal q-button-group-attached')
    expect(buttonGroup({ orientation: 'vertical', attached: false }, 'extra'))
      .toBe('q-button-group q-button-group-vertical q-button-group-spaced extra')
  })
})
