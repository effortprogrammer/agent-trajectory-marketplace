import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Autocomplete } from './index.ts'

const FRUITS = ['Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry', 'Grape', 'Mango', 'Orange']

function Basic(props: Partial<Parameters<typeof Autocomplete.Root>[0]> = {}) {
  return (
    <Autocomplete.Root items={FRUITS} openOnInputClick {...props}>
      <Autocomplete.Input placeholder="Search fruits" />
      <Autocomplete.Content>
        <Autocomplete.Empty>No fruits found.</Autocomplete.Empty>
        <Autocomplete.List>
          {(item: string) => (
            <Autocomplete.Item key={item} value={item}>{item}</Autocomplete.Item>
          )}
        </Autocomplete.List>
      </Autocomplete.Content>
    </Autocomplete.Root>
  )
}

describe('Autocomplete', () => {
  it('renders the input on the canonical field surface with a search affix', () => {
    render(<Basic />)
    const input = screen.getByPlaceholderText('Search fruits')
    expect(input).toHaveClass('q-field-input')
    expect(input.closest('.q-field-control')).toHaveClass('q-autocomplete-control')
  })

  it('exposes the input as a combobox', () => {
    render(<Basic />)
    expect(screen.getByRole('combobox')).toBe(screen.getByPlaceholderText('Search fruits'))
  })

  it('filters the list as the user types (Base UI matching)', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'ap')

    // Substring match against the items prop: Apple, Apricot, Grape.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Apricot' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Grape' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Banana' })).not.toBeInTheDocument()
  })

  it('renders the empty state when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'zzz')
    expect(await screen.findByText('No fruits found.')).toBeInTheDocument()
  })

  it('fires onValueChange as the input changes', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Basic onValueChange={onValueChange} />)
    await user.type(screen.getByRole('combobox'), 'man')
    expect(onValueChange).toHaveBeenCalled()
    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe('man')
  })

  it('clears the value via the Clear button', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    await user.type(input, 'Banana')
    expect(input.value).toBe('Banana')

    const clearBtn = document.querySelector('.q-autocomplete-clear')
    expect(clearBtn).not.toBeNull()
    await user.click(clearBtn!)
    expect(input.value).toBe('')
  })

  it('paints popup + rows with the shared glass / menu utilities', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    await user.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: 'Apple' })
    expect(option).toHaveClass('q-menu-item')
    expect(option.closest('.q-dropdown-content')).toHaveClass('q-autocomplete-content')
  })

  it('composes rich item rows from the shared parts', async () => {
    const user = userEvent.setup()
    render(
      <Autocomplete.Root items={FRUITS} openOnInputClick>
        <Autocomplete.Input placeholder="Search" />
        <Autocomplete.Content>
          <Autocomplete.List>
            {(item: string) => (
              <Autocomplete.Item key={item} value={item}>
                <Autocomplete.ItemContent>
                  <Autocomplete.ItemTitleRow>
                    <Autocomplete.ItemTitle>{item}</Autocomplete.ItemTitle>
                  </Autocomplete.ItemTitleRow>
                  <Autocomplete.ItemDescription>A fruit</Autocomplete.ItemDescription>
                </Autocomplete.ItemContent>
              </Autocomplete.Item>
            )}
          </Autocomplete.List>
        </Autocomplete.Content>
      </Autocomplete.Root>,
    )
    await user.click(screen.getByRole('combobox'))
    const title = await screen.findByText('Apple')
    expect(title).toHaveClass('q-menu-item-title')
    expect(screen.getAllByText('A fruit')[0]).toHaveClass('q-menu-item-description')
  })

  it('selects an item on click and fills the input', async () => {
    const user = userEvent.setup()
    render(<Basic />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    await user.click(input)
    await user.click(await screen.findByRole('option', { name: 'Cherry' }))
    expect(input.value).toBe('Cherry')
  })

  it('forwards a ref to the underlying input element', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <Autocomplete.Root items={FRUITS}>
        <Autocomplete.Input ref={ref} placeholder="Search" />
        <Autocomplete.Content>
          <Autocomplete.List>
            {(item: string) => <Autocomplete.Item key={item} value={item}>{item}</Autocomplete.Item>}
          </Autocomplete.List>
        </Autocomplete.Content>
      </Autocomplete.Root>,
    )
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current).toBe(screen.getByPlaceholderText('Search'))
  })

  it('omits the clear button when clear is false', () => {
    render(
      <Autocomplete.Root items={FRUITS}>
        <Autocomplete.Input placeholder="Search" clear={false} />
        <Autocomplete.Content>
          <Autocomplete.List>
            {(item: string) => <Autocomplete.Item key={item} value={item}>{item}</Autocomplete.Item>}
          </Autocomplete.List>
        </Autocomplete.Content>
      </Autocomplete.Root>,
    )
    expect(document.querySelector('.q-autocomplete-clear')).toBeNull()
  })
})
