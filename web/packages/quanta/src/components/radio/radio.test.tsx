import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Radio, RadioGroup, RadioLabel, radio } from './index.ts'

describe('radio() class-builder', () => {
  it('defaults to brand + md', () => {
    expect(radio()).toBe('q-radio q-radio-brand q-radio-md')
  })

  it('applies color + size and merges extras', () => {
    expect(radio({ color: 'white', size: 'lg' }, 'is-custom', false)).toBe(
      'q-radio q-radio-white q-radio-lg is-custom',
    )
  })
})

describe('<Radio> in a <RadioGroup>', () => {
  it('renders Base UI radios with Figma classes and reflects the selected value', () => {
    render(
      <RadioGroup defaultValue="a">
        <Radio value="a" aria-label="A" color="white" size="sm" />
        <Radio value="b" aria-label="B" />
      </RadioGroup>,
    )
    const a = screen.getByRole('radio', { name: 'A' })
    expect(a).toHaveClass('q-radio', 'q-radio-white', 'q-radio-sm')
    expect(a).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'false')
  })

  it('moves selection on click (single-select)', async () => {
    const user = userEvent.setup()
    render(
      <RadioGroup defaultValue="a">
        <Radio value="a" aria-label="A" />
        <Radio value="b" aria-label="B" />
      </RadioGroup>,
    )
    await user.click(screen.getByRole('radio', { name: 'B' }))
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'false')
  })

  it('applies the group layout class', () => {
    const { container } = render(
      <RadioGroup aria-label="group"><Radio value="a" aria-label="A" /></RadioGroup>,
    )
    expect(container.querySelector('[role="radiogroup"]')).toHaveClass('q-radio-group')
  })
})

describe('<RadioLabel>', () => {
  it('renders the label, description and a selected radio', () => {
    render(
      <RadioGroup defaultValue="x">
        <RadioLabel value="x" label="Option X" description="Description" />
      </RadioGroup>,
    )
    // Title/description are now rendered by <Typography>: the composite type +
    // semantic colour classes sit alongside the kept q-radio-label-* hooks.
    const title = screen.getByText('Option X')
    expect(title).toHaveClass('q-radio-label-title', 'text-q-label-sm-medium', 'text-q-text-primary')
    const description = screen.getByText('Description')
    expect(description).toHaveClass('q-radio-label-description', 'text-q-label-sm-regular', 'text-q-text-tertiary')
    const r = screen.getByRole('radio')
    expect(r).toHaveClass('q-radio')
    expect(r).toHaveAttribute('aria-checked', 'true')
  })

  it('supports right-aligned radio and medium label typography', () => {
    render(
      <RadioGroup>
        <RadioLabel value="x" direction="right" size="md" label="Option" />
      </RadioGroup>,
    )
    expect(screen.getByText('Option').closest('.q-radio-label')).toHaveClass(
      'q-radio-label-right',
      'q-radio-label-md',
    )
    // md label size drives the md title composite via <Typography>.
    expect(screen.getByText('Option')).toHaveClass('text-q-label-md-medium')
  })
})
