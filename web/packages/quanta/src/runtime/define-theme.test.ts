import { afterEach, describe, expect, it } from 'vitest'
import { defineTheme, hasTheme, hydratePersistedThemes, listThemes, removeTheme } from './define-theme.ts'
import { DEFAULT_THEMES_STORAGE_KEY } from './storage-keys.ts'
import { memoryStorage } from './storage.ts'

afterEach(() => {
  for (const name of listThemes()) removeTheme(name)
})

describe('defineTheme — injection guard', () => {
  it('injects a :where block for valid tokens (the happy path still works)', () => {
    defineTheme('ai-ocean', {
      'surface-default': '#0c2461',
      'text-primary': 'oklch(0.92 0.02 240)',
      'brand-primary': 'var(--hf-color-fallback, #fbbf24)',
      'glow': 'linear-gradient(90deg, #000 0%, #fff 100%)',
    }, { persist: false })

    const tag = document.getElementById('hf-runtime-theme-ai-ocean')
    expect(tag?.textContent).toContain(':where([data-theme="ai-ocean"])')
    expect(tag?.textContent).toContain('--hf-color-glow: linear-gradient(90deg, #000 0%, #fff 100%);')
  })

  it.each([
    ['a `}` in a value escapes the block', { 'surface-default': '#fff} body{background:url(//evil)' }],
    ['a `;` in a value smuggles a sibling declaration', { 'surface-default': 'red; background-image: url(//evil)' }],
    ['a control character in a value', { 'surface-default': 'red\u0000' }],
  ])('rejects %s', (_label, tokens) => {
    expect(() => defineTheme('attack', tokens, { persist: false })).toThrowError(/invalid value/)
    expect(document.getElementById('hf-runtime-theme-attack')).toBeNull()
    expect(hasTheme('attack')).toBe(false)
  })

  it('rejects a token key that is not slug-shaped', () => {
    expect(() => defineTheme('t', { 'a:red;b': '#fff' }, { persist: false })).toThrowError(/invalid token key/)
  })

  it('rejects a theme name that would escape the attribute selector', () => {
    expect(() => defineTheme('x"]{}', { a: '#fff' }, { persist: false })).toThrowError(/invalid theme name/)
  })

  it('a bad redefinition does NOT destroy the valid theme it tried to replace', () => {
    defineTheme('keeper', { a: '#fff' }, { persist: false })
    expect(() => defineTheme('keeper', { a: 'bad}' }, { persist: false })).toThrowError(/invalid value/)
    expect(hasTheme('keeper')).toBe(true)
    expect(document.getElementById('hf-runtime-theme-keeper')).not.toBeNull()
  })

  it('a bad value never reaches persistence', () => {
    const storage = memoryStorage()
    expect(() => defineTheme('t', { a: 'bad}' }, { storage })).toThrowError(/invalid value/)
    expect(storage.get(DEFAULT_THEMES_STORAGE_KEY)).toBeNull()
  })
})

describe('hydratePersistedThemes — poisoned storage', () => {
  it('skips an entry someone wrote past the guard, hydrates the rest', () => {
    const storage = memoryStorage()
    storage.set(DEFAULT_THEMES_STORAGE_KEY, JSON.stringify({
      'evil': { a: '#fff} body{display:none' }, // written to storage directly
      'fine': { a: '#fff' },
    }))

    hydratePersistedThemes({ storage })

    expect(document.getElementById('hf-runtime-theme-evil')).toBeNull()
    expect(document.getElementById('hf-runtime-theme-fine')).not.toBeNull()
  })
})
