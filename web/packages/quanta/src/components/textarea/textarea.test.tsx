import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Textarea } from './index.ts'

describe('<Textarea>', () => {
  it('renders a multiline control on the column surface', () => {
    const { container } = render(<Textarea label="Bio" rows={4} />)
    const ta = screen.getByLabelText('Bio')
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta).toHaveClass('q-field-input', 'q-field-input-multiline')
    expect(container.querySelector('.q-field')).toHaveClass('q-field-multiline')
    expect(container.querySelector('.q-field-control')).toHaveClass('q-field-control-multiline')
  })

  it('renders the helper description', () => {
    render(<Textarea label="Bio" description="We'll never share this" />)
    expect(screen.getByText('We\'ll never share this')).toHaveClass('q-field-description')
  })

  it('shows the error (red) state and message instead of the description', () => {
    const { container } = render(
      <Textarea label="Notes" description="helper" error="Please enter only letters" defaultValue="Mary387" />,
    )
    expect(screen.getByText('Please enter only letters')).toHaveClass('q-field-error')
    expect(screen.queryByText('helper')).not.toBeInTheDocument()
    expect(container.querySelector('.q-field-control')).toHaveClass('q-field-control-invalid')
    expect(container.querySelector('.q-field-label')).toHaveClass('q-field-label-invalid')
  })

  it('accepts typed input', async () => {
    const user = userEvent.setup()
    render(<Textarea label="Bio" />)
    const ta = screen.getByLabelText('Bio')
    await user.type(ta, 'Hello')
    expect(ta).toHaveValue('Hello')
  })

  it('renders canonical start / end affix slots', () => {
    render(
      <Textarea
        label="Bio"
        start={<span data-testid="lead" />}
        end={<span data-testid="trail" />}
      />,
    )
    expect(screen.getByTestId('lead').closest('.q-field-affix')).toBeInTheDocument()
    expect(screen.getByTestId('trail').closest('.q-field-affix')).toBeInTheDocument()
  })

  it('keeps the legacy prefix / suffix aliases (back-compat)', () => {
    render(
      <Textarea
        label="Bio"
        prefix={<span data-testid="legacy-lead" />}
        suffix={<span data-testid="legacy-trail" />}
      />,
    )
    expect(screen.getByTestId('legacy-lead').closest('.q-field-affix')).toBeInTheDocument()
    expect(screen.getByTestId('legacy-trail').closest('.q-field-affix')).toBeInTheDocument()
  })

  it('renders a bare textarea control with no affixes by default (back-compat)', () => {
    const { container } = render(<Textarea label="Bio" />)
    expect(container.querySelector('.q-field-affix')).toBeNull()
    expect(screen.getByLabelText('Bio').tagName).toBe('TEXTAREA')
  })

  it('swaps the control element via render', () => {
    render(<Textarea label="Bio" render={<textarea data-testid="custom" />} />)
    const ta = screen.getByTestId('custom')
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta).toHaveClass('q-field-input')
  })
})
