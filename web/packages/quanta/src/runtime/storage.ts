/**
 * Storage adapters for runtime theme persistence.
 *
 * `defineTheme` (tokens map) and `ThemeController.setOverride` (pinned
 * theme name) can each be pointed at any storage backend implementing
 * the `ThemeStorage` interface — localStorage, sessionStorage, URL
 * search params, or a custom adapter.
 *
 * Recommended pairings:
 *   - localStorageAdapter — default; cross-tab, cross-reload (typical)
 *   - sessionStorageAdapter — per-tab themes (different theme per tab)
 *   - urlAdapter() — for the override name only; produces shareable
 *     "look-at-this-theme" links. Don't use for tokens map (too big for URL).
 *   - memoryStorage() — for SSR / tests; lives only in this process.
 *
 * The `pref` and `brand` storage (managed-mode user preferences) remain
 * on `localStorage` and are not pluggable — those are conceptually
 * device-bound user settings, not theme content.
 */

export interface ThemeStorage {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

// ────────────────────────────────────────────────────────────────────
// Built-in adapters
// ────────────────────────────────────────────────────────────────────

export const localStorageAdapter: ThemeStorage = {
  get(key) {
    try {
      return localStorage.getItem(key)
    }
    catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    }
    catch {
      // QuotaExceeded / privacy mode — silently degrade.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key)
    }
    catch {
      // silently degrade
    }
  },
}

export const sessionStorageAdapter: ThemeStorage = {
  get(key) {
    try {
      return sessionStorage.getItem(key)
    }
    catch {
      return null
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value)
    }
    catch {
      // QuotaExceeded / privacy mode — silently degrade.
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key)
    }
    catch {
      // silently degrade
    }
  },
}

export interface UrlAdapterOptions {
  /**
   * Which part of the URL to use for storage. `search` → ?key=value
   * (visible in URL bar, shareable). `hash` → #key=value (client-only,
   * not sent to server). Default: 'search'.
   */
  mode?: 'search' | 'hash'
}

/**
 * URL search-param or hash storage. Best for the override NAME only
 * — token JSON maps are too large for URLs in practice. Use case:
 * shareable theme links ("send your friend a link with `?theme=ai-ocean`").
 *
 * Writes use `history.replaceState` — no navigation, no scroll jump.
 */
export function urlAdapter({ mode = 'search' }: UrlAdapterOptions = {}): ThemeStorage {
  function readParams(): URLSearchParams {
    if (mode === 'hash') {
      // Hash form like "#theme=ai-ocean&foo=bar". Strip the leading "#".
      return new URLSearchParams(window.location.hash.replace(/^#/, ''))
    }
    return new URLSearchParams(window.location.search)
  }

  function writeParams(params: URLSearchParams): void {
    const serialized = params.toString()
    const path = window.location.pathname
    if (mode === 'hash') {
      const newUrl = serialized ? `${path}${window.location.search}#${serialized}` : path + window.location.search
      window.history.replaceState(null, '', newUrl)
    }
    else {
      const newUrl = serialized ? `${path}?${serialized}${window.location.hash}` : path + window.location.hash
      window.history.replaceState(null, '', newUrl)
    }
  }

  return {
    get(key) {
      try {
        return readParams().get(key)
      }
      catch {
        return null
      }
    },
    set(key, value) {
      try {
        const params = readParams()
        params.set(key, value)
        writeParams(params)
      }
      catch {
        // SSR / no window — silently degrade.
      }
    },
    remove(key) {
      try {
        const params = readParams()
        params.delete(key)
        writeParams(params)
      }
      catch {
        // silently degrade
      }
    },
  }
}

/**
 * In-memory storage. Lives only in the current JS process — never
 * survives reload. Useful for SSR (no window) and tests.
 */
export function memoryStorage(): ThemeStorage {
  const store = new Map<string, string>()
  return {
    get: key => store.get(key) ?? null,
    set: (key, value) => {
      store.set(key, value)
    },
    remove: (key) => {
      store.delete(key)
    },
  }
}
