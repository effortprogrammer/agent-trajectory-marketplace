import { beforeEach, describe, expect, it } from 'vitest'
import {
  localStorageAdapter,
  memoryStorage,
  sessionStorageAdapter,
  urlAdapter,
} from './storage.ts'

describe('Side-effect contract', () => {
  describe('localStorageAdapter', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('round-trips set → get', () => {
      localStorageAdapter.set('foo', 'bar')
      expect(localStorageAdapter.get('foo')).toBe('bar')
    })

    it('returns null for missing keys', () => {
      expect(localStorageAdapter.get('missing')).toBeNull()
    })

    it('remove() makes subsequent get() return null', () => {
      localStorageAdapter.set('foo', 'bar')
      localStorageAdapter.remove('foo')
      expect(localStorageAdapter.get('foo')).toBeNull()
    })

    it('does not throw if backing store throws on set', () => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new Error('QuotaExceeded')
      }
      expect(() => localStorageAdapter.set('k', 'v')).not.toThrow()
      Storage.prototype.setItem = original
    })
  })

  describe('sessionStorageAdapter', () => {
    beforeEach(() => {
      sessionStorage.clear()
    })

    it('round-trips set → get → remove', () => {
      sessionStorageAdapter.set('a', '1')
      expect(sessionStorageAdapter.get('a')).toBe('1')
      sessionStorageAdapter.remove('a')
      expect(sessionStorageAdapter.get('a')).toBeNull()
    })

    it('is isolated from localStorage', () => {
      sessionStorageAdapter.set('iso', 'session')
      expect(localStorageAdapter.get('iso')).toBeNull()
    })
  })

  describe('urlAdapter (search mode)', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/')
    })

    it('writes to ?search and reads back', () => {
      const adapter = urlAdapter()
      adapter.set('theme', 'ai-ocean')
      expect(window.location.search).toContain('theme=ai-ocean')
      expect(adapter.get('theme')).toBe('ai-ocean')
    })

    it('remove() drops the key from the URL', () => {
      const adapter = urlAdapter()
      adapter.set('theme', 'ai-ocean')
      adapter.remove('theme')
      expect(adapter.get('theme')).toBeNull()
      expect(window.location.search).not.toContain('theme=')
    })

    it('preserves other search params on set', () => {
      window.history.replaceState(null, '', '/?utm=src')
      const adapter = urlAdapter()
      adapter.set('theme', 'ai-ocean')
      expect(window.location.search).toContain('utm=src')
      expect(window.location.search).toContain('theme=ai-ocean')
    })

    it('encodes special characters', () => {
      const adapter = urlAdapter()
      adapter.set('theme', 'a b/c')
      expect(adapter.get('theme')).toBe('a b/c')
    })
  })

  describe('urlAdapter (hash mode)', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/')
    })

    it('writes to #hash, not ?search', () => {
      const adapter = urlAdapter({ mode: 'hash' })
      adapter.set('theme', 'ai-ocean')
      expect(window.location.hash).toContain('theme=ai-ocean')
      expect(window.location.search).toBe('')
    })

    it('reads back from hash', () => {
      const adapter = urlAdapter({ mode: 'hash' })
      adapter.set('theme', 'ai-ocean')
      expect(adapter.get('theme')).toBe('ai-ocean')
    })

    it('ignores ?search params even when populated', () => {
      window.history.replaceState(null, '', '/?theme=from-search')
      const adapter = urlAdapter({ mode: 'hash' })
      expect(adapter.get('theme')).toBeNull()
    })
  })

  describe('memoryStorage', () => {
    it('round-trips within one instance', () => {
      const m = memoryStorage()
      m.set('k', 'v')
      expect(m.get('k')).toBe('v')
      m.remove('k')
      expect(m.get('k')).toBeNull()
    })

    it('is isolated between instances', () => {
      const a = memoryStorage()
      const b = memoryStorage()
      a.set('k', 'a-val')
      expect(b.get('k')).toBeNull()
    })

    it('does not touch localStorage', () => {
      const m = memoryStorage()
      m.set('mem', 'only')
      expect(localStorage.getItem('mem')).toBeNull()
    })
  })
})
