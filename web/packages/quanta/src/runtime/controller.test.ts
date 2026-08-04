import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readInitialThemeState } from './controller.ts'
import {
  DEFAULT_OVERRIDE_STORAGE_KEY,
  DEFAULT_STORAGE_KEY,
} from './storage-keys.ts'
import { memoryStorage } from './storage.ts'

/**
 * `prefers-color-scheme` is a 3-state signal: dark, light, or none.
 * Mock both query forms so tests can express each state explicitly.
 */
function mockMatchMedia(systemPref: 'dark' | 'light' | 'none') {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('dark')
      ? systemPref === 'dark'
      : q.includes('light')
        ? systemPref === 'light'
        : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  }))
}

describe('State machine behavior', () => {
  describe('readInitialThemeState', () => {
    beforeEach(() => {
      localStorage.clear()
      mockMatchMedia('none')
    })

    it('defaults to pref=auto, dark when storage empty + no system pref', () => {
      const s = readInitialThemeState()
      expect(s).toEqual({
        pref: 'auto',
        brand: 'default',
        resolvedTheme: 'default-dark',
        override: null,
        activeTheme: 'default-dark',
      })
    })

    it('honours stored pref=dark', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'dark')
      const s = readInitialThemeState()
      expect(s.pref).toBe('dark')
      expect(s.resolvedTheme).toBe('default-dark')
      expect(s.activeTheme).toBe('default-dark')
    })

    it('resolves auto + system dark MQ → dark', () => {
      mockMatchMedia('dark')
      const s = readInitialThemeState()
      expect(s.pref).toBe('auto')
      expect(s.resolvedTheme).toBe('default-dark')
    })

    it('resolves auto + system light MQ → light', () => {
      mockMatchMedia('light')
      const s = readInitialThemeState()
      expect(s.pref).toBe('auto')
      expect(s.resolvedTheme).toBe('default-light')
    })

    it('treats garbage pref as auto', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'midnight')
      const s = readInitialThemeState()
      expect(s.pref).toBe('auto')
    })

    it('respects custom brand', () => {
      const s = readInitialThemeState({ brand: 'acme' })
      expect(s.brand).toBe('acme')
      expect(s.resolvedTheme).toBe('acme-dark')
    })

    it('override wins over resolved theme for activeTheme; resolved stays', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'dark')
      localStorage.setItem(DEFAULT_OVERRIDE_STORAGE_KEY, 'ai-ocean')
      const s = readInitialThemeState()
      expect(s.resolvedTheme).toBe('default-dark')
      expect(s.override).toBe('ai-ocean')
      expect(s.activeTheme).toBe('ai-ocean')
    })

    it('reads override from injected storage adapter, not localStorage', () => {
      const override = memoryStorage()
      override.set(DEFAULT_OVERRIDE_STORAGE_KEY, 'from-memory')
      localStorage.setItem(DEFAULT_OVERRIDE_STORAGE_KEY, 'from-localstorage')
      const s = readInitialThemeState({ overrideStorage: override })
      expect(s.override).toBe('from-memory')
      expect(s.activeTheme).toBe('from-memory')
    })

    it('honours custom storage keys', () => {
      localStorage.setItem('my-pref', 'dark')
      localStorage.setItem('my-override', 'pinned')
      const s = readInitialThemeState({
        storageKey: 'my-pref',
        overrideStorageKey: 'my-override',
      })
      expect(s.pref).toBe('dark')
      expect(s.override).toBe('pinned')
    })

    it('SSR fallback: returns defaults when window is undefined', () => {
      const w = globalThis.window
      // @ts-expect-error — simulating SSR
      delete globalThis.window
      try {
        const s = readInitialThemeState({ brand: 'acme' })
        expect(s).toEqual({
          pref: 'auto',
          brand: 'acme',
          resolvedTheme: 'acme-dark',
          override: null,
          activeTheme: 'acme-dark',
        })
      }
      finally {
        globalThis.window = w
      }
    })

    it('does not throw when localStorage.getItem throws (Safari Private Mode)', () => {
      const original = Storage.prototype.getItem
      Storage.prototype.getItem = () => {
        throw new Error('SecurityError')
      }
      try {
        const s = readInitialThemeState()
        expect(s.pref).toBe('auto')
        expect(s.resolvedTheme).toBe('default-dark')
      }
      finally {
        Storage.prototype.getItem = original
      }
    })

    it('does not throw when matchMedia is absent (partial DOM)', () => {
      const original = window.matchMedia
      // @ts-expect-error — simulating partial DOM where matchMedia is missing
      window.matchMedia = undefined
      try {
        const s = readInitialThemeState()
        expect(s.pref).toBe('auto')
        // matchMedia missing → fall through to package default (dark)
        expect(s.resolvedTheme).toBe('default-dark')
      }
      finally {
        window.matchMedia = original
      }
    })
  })
})
