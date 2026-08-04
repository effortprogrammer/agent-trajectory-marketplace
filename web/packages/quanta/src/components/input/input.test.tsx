import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Input } from './index.ts'

describe('<Input>', () => {
  it('associates the label with the control', () => {
    render(<Input label="Email" placeholder="you@example.com" />)
    const input = screen.getByLabelText('Email')
    expect(input).toHaveClass('q-field-input')
    expect(input.tagName).toBe('INPUT')
  })

  it('renders the helper description', () => {
    render(<Input label="Name" description="We'll never share this" />)
    expect(screen.getByText('We\'ll never share this')).toHaveClass('q-field-description')
  })

  it('shows the error (red) state and message instead of the description', () => {
    const { container } = render(
      <Input label="Name" description="helper" error="Please enter only letters" defaultValue="Mary387" />,
    )
    expect(screen.getByText('Please enter only letters')).toHaveClass('q-field-error')
    expect(screen.queryByText('helper')).not.toBeInTheDocument()
    expect(container.querySelector('.q-field-control')).toHaveClass('q-field-control-invalid')
    expect(container.querySelector('.q-field-label')).toHaveClass('q-field-label-invalid')
    expect(screen.getByDisplayValue('Mary387')).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders start and end slots', () => {
    const { container } = render(
      <Input label="Search" start={<span data-testid="pre" />} end={<span data-testid="suf" />} />,
    )
    expect(container.querySelectorAll('.q-field-affix')).toHaveLength(2)
    expect(screen.getByTestId('pre')).toBeInTheDocument()
    expect(screen.getByTestId('suf')).toBeInTheDocument()
  })

  it('accepts the deprecated prefix / suffix aliases (back-compat)', () => {
    render(
      <Input label="Search" prefix={<span data-testid="pre" />} suffix={<span data-testid="suf" />} />,
    )
    expect(screen.getByTestId('pre')).toBeInTheDocument()
    expect(screen.getByTestId('suf')).toBeInTheDocument()
  })

  it('accepts typed input', async () => {
    const user = userEvent.setup()
    render(<Input label="Name" />)
    const input = screen.getByLabelText('Name')
    await user.type(input, 'Ada')
    expect(input).toHaveValue('Ada')
  })
})
