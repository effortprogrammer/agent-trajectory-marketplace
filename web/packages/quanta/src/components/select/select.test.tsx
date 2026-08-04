import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { IconFolder1Outlined as FolderIcon } from '@higgsfield-ai/icons/IconFolder1Outlined'
import { describe, expect, it, vi } from 'vitest'
import { Select } from './index.ts'

/** A title-only option (the common composition). */
function Option({ value, label }: { value: string, label: string }) {
  return (
    <Select.Item value={value}>
      <Select.ItemText>{label}</Select.ItemText>
      <Select.ItemIndicator />
    </Select.Item>
  )
}

// Base UI resolves the trigger Value label from `items` when the popup is closed.
const MODEL_ITEMS = { soul: 'Soul 2.0', gpt: 'GPT Image 2', kling: 'Kling 3.0' }

function Basic({ defaultOpen = false, ...rootProps }: Partial<Parameters<typeof Select.Root>[0]> & { defaultOpen?: boolean }) {
  return (
    <Select.Root defaultOpen={defaultOpen} items={MODEL_ITEMS} {...rootProps}>
      <Select.Trigger>
        <Select.Value placeholder="Choose a model" />
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          <Select.GroupLabel>Models</Select.GroupLabel>
          <Option value="soul" label="Soul 2.0" />
          <Option value="gpt" label="GPT Image 2" />
          <Option value="kling" label="Kling 3.0" />
        </Select.Group>
      </Select.Content>
    </Select.Root>
  )
}

describe('Select trigger', () => {
  it('renders a combobox trigger that looks like a field', () => {
    render(<Basic />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveClass('q-field-control', 'q-select-trigger')
  })

  it('shows the placeholder when no value is selected', () => {
    render(<Basic />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Choose a model')
    expect(screen.getByRole('combobox')).toHaveAttribute('data-placeholder')
  })

  it('applies the size preset to the trigger', () => {
    render(
      <Select.Root>
        <Select.Trigger size="lg"><Select.Value placeholder="x" /><Select.Icon /></Select.Trigger>
        <Select.Content><Option value="a" label="A" /></Select.Content>
      </Select.Root>,
    )
    expect(screen.getByRole('combobox')).toHaveClass('q-select-trigger-lg')
  })

  it('paints the invalid ring when invalid', () => {
    render(
      <Select.Root>
        <Select.Trigger invalid><Select.Value placeholder="x" /><Select.Icon /></Select.Trigger>
        <Select.Content><Option value="a" label="A" /></Select.Content>
      </Select.Root>,
    )
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveClass('q-field-control-invalid')
    expect(trigger).toHaveAttribute('data-invalid')
  })

  it('disables the trigger when the root is disabled', () => {
    render(
      <Select.Root disabled>
        <Select.Trigger><Select.Value placeholder="x" /><Select.Icon /></Select.Trigger>
        <Select.Content><Option value="a" label="A" /></Select.Content>
      </Select.Root>,
    )
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('forwards a ref to the trigger button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Select.Root>
        <Select.Trigger ref={ref}><Select.Value placeholder="x" /><Select.Icon /></Select.Trigger>
        <Select.Content><Option value="a" label="A" /></Select.Content>
      </Select.Root>,
    )
    expect(ref.current).toBe(screen.getByRole('combobox'))
  })
})

describe('Select popup', () => {
  it('renders the dropdown glass surface (defaultOpen)', () => {
    render(<Basic defaultOpen />)
    // The glass surface is the popup; role=listbox is on the inner scroll list.
    expect(screen.getByRole('listbox').closest('.q-select-content')).toHaveClass('q-dropdown-content', 'q-select-content')
  })

  it('applies the solid surface preset', () => {
    render(
      <Select.Root defaultOpen>
        <Select.Trigger><Select.Value placeholder="x" /><Select.Icon /></Select.Trigger>
        <Select.Content surface="solid"><Option value="a" label="A" /></Select.Content>
      </Select.Root>,
    )
    expect(screen.getByRole('listbox').closest('.q-select-content')).toHaveClass('q-dropdown-content-solid')
  })

  it('renders a group label and option rows', () => {
    render(<Basic defaultOpen />)
    expect(screen.getByText('Models')).toHaveClass('q-menu-group-label')
    expect(screen.getByRole('option', { name: 'Soul 2.0' })).toHaveClass('q-menu-item', 'q-select-item')
  })

  it('renders an option with a leading icon (composition)', () => {
    render(
      <Select.Root defaultOpen>
        <Select.Trigger><Select.Value placeholder="x" /><Select.Icon /></Select.Trigger>
        <Select.Content>
          <Select.Item value="folder">
            <Select.ItemIcon><FolderIcon /></Select.ItemIcon>
            <Select.ItemText>Folder</Select.ItemText>
            <Select.ItemIndicator />
          </Select.Item>
        </Select.Content>
      </Select.Root>,
    )
    const option = screen.getByRole('option', { name: 'Folder' })
    expect(option.querySelector('.q-menu-item-icon')).toBeInTheDocument()
  })
})

describe('Select selection', () => {
  it('seeds the trigger value from defaultValue', () => {
    render(<Basic defaultValue="gpt" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('GPT Image 2')
    expect(screen.getByRole('combobox')).not.toHaveAttribute('data-placeholder')
  })

  it('selects an option on click and echoes it into the trigger', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Kling 3.0' }))
    expect(screen.getByRole('combobox')).toHaveTextContent('Kling 3.0')
  })

  it('fires onValueChange with the chosen value', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Basic onValueChange={onValueChange} />)
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Soul 2.0' }))
    expect(onValueChange).toHaveBeenCalledWith('soul', expect.anything())
  })

  it('marks the selected option with data-selected', () => {
    render(<Basic defaultOpen defaultValue="soul" />)
    expect(screen.getByRole('option', { name: 'Soul 2.0' })).toHaveAttribute('data-selected')
    expect(screen.getByRole('option', { name: 'GPT Image 2' })).not.toHaveAttribute('data-selected')
  })

  it('supports multiple selection (value is an array)', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Select.Root multiple onValueChange={onValueChange}>
        <Select.Trigger><Select.Value placeholder="Pick" /><Select.Icon /></Select.Trigger>
        <Select.Content>
          <Option value="a" label="Alpha" />
          <Option value="b" label="Beta" />
        </Select.Content>
      </Select.Root>,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Alpha' }))
    expect(onValueChange).toHaveBeenLastCalledWith(['a'], expect.anything())
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onValueChange).toHaveBeenLastCalledWith(['a', 'b'], expect.anything())
  })
})
