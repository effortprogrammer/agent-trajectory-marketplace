/**
 * Runtime theme injection — opinionated recipe implementation.
 *
 * Injects a <style> tag with a :where([data-theme="<name>"]) block,
 * populating --hf-color-* storage. Tailwind utilities pick up the values
 * via the @theme inline alias in tailwind.css.
 *
 * Activate via the ThemeController escape hatch (`controller.setOverride(name)`).
 * The controller pins data-theme to this name and preserves pref/brand so
 * clearing the override restores the managed theme.
 *
 * Usage:
 *   defineTheme("ai-ocean", {
 *     "surface-default":  "#0c2461",
 *     "text-primary":     "#dbeafe",
 *     "brand-primary":    "#fbbf24",
 *   });
 *   controller.setOverride("ai-ocean");
 *
 *   // later
 *   controller.setOverride(null);
 *   removeTheme("ai-ocean");
 *
 * Persistence:
 *   defineTheme writes tokens to `storage` (localStorage by default).
 *   After reload, calling `hydratePersistedThemes()` (or a ThemeController
 *   with `hydrateThemes: true`, the default) re-injects the <style> tags
 *   before the controller applies data-theme. Disable persistence with
 *   `defineTheme(name, tokens, { persist: false })` — an ephemeral theme.
 *   Switch the backend with
 *   `defineTheme(name, tokens, { storage: sessionStorageAdapter })`.
 *   In strict CSP environments, pass `{ styleNonce }` for injected <style>
 *   tags created after hydration.
 *
 * Without ThemeController you can set it manually:
 * `document.documentElement.dataset.theme = "ai-ocean"` — but then the
 * controller doesn't know about the change and subscribers won't fire.
 */

import type { ThemeStorage } from './storage.ts'
import { DEFAULT_THEMES_STORAGE_KEY } from './storage-keys.ts'
import { localStorageAdapter } from './storage.ts'

export type ThemeTokens = Record<string, string>

export interface DefineThemeOptions {
  /**
   * Write tokens to storage so the theme survives reload.
   * Default: true. Pass `false` for ephemeral / A-B-test overlays.
   */
  persist?: boolean
  /**
   * Storage backend for persisted tokens. Default: `localStorageAdapter`.
   * Use `sessionStorageAdapter` for per-tab themes, `memoryStorage()` for
   * SSR/tests, or any custom `ThemeStorage`. (URL not recommended for
   * tokens — JSON maps are too large for URLs.)
   */
  storage?: ThemeStorage
  /** CSP nonce for the runtime <style> tag injected into document.head. */
  styleNonce?: string
}

export interface HydrateOptions {
  /** Storage to read persisted themes from. Default: `localStorageAdapter`. */
  storage?: ThemeStorage
  /** CSP nonce for the runtime <style> tags injected into document.head. */
  styleNonce?: string
}

export interface RemoveThemeOptions {
  /** Storage to also remove persisted tokens from. Default: `localStorageAdapter`. */
  storage?: ThemeStorage
}

const PREFIX = 'hf' // matches the namespace in primitives.css / theme.css
const STYLE_ID_PREFIX = `${PREFIX}-runtime-theme-`
const THEMES_STORAGE_KEY = DEFAULT_THEMES_STORAGE_KEY

const styleTags = new Map<string, HTMLStyleElement>()

// ── injection guard ──────────────────────────────────────────────────
// Theme names become selector text and token keys/values become declaration
// text VERBATIM — and the docs pitch AI-generated themes, so treat all three
// as untrusted. textContent on a <style> can't break into HTML, but a `}` in
// a value (or a `"]` in a name) escapes the `:where()` block and writes
// arbitrary page CSS. Names/keys are slug-shaped; values may be any CSS
// expression that cannot terminate the declaration or the block.
const NAME_OR_KEY = /^[a-z0-9][\w-]*$/i
// eslint-disable-next-line no-control-regex -- control chars are the point
const VALUE_FORBIDDEN = /[;{}\u0000-\u001F\u007F]/

function assertInjectable(name: string, tokens: ThemeTokens): void {
  if (typeof name !== 'string' || !NAME_OR_KEY.test(name))
    throw new Error(`defineTheme: invalid theme name '${name}' — use letters, digits, '-', '_'`)
  for (const [key, val] of Object.entries(tokens)) {
    if (!NAME_OR_KEY.test(key))
      throw new Error(`defineTheme: invalid token key '${key}' in theme '${name}' — use letters, digits, '-', '_'`)
    if (typeof val !== 'string' || VALUE_FORBIDDEN.test(val))
      throw new Error(`defineTheme: invalid value for token '${key}' in theme '${name}' — a CSS value can't contain ';', '{', '}' or control characters`)
  }
}

export function defineTheme(name: string, tokens: ThemeTokens, options: DefineThemeOptions = {}): void {
  if (typeof name !== 'string' || !name) {
    throw new Error('defineTheme: name must be non-empty string')
  }
  if (!tokens || typeof tokens !== 'object') {
    throw new Error('defineTheme: tokens must be object')
  }
  // Validate BEFORE removeTheme below — a bad input must not destroy the
  // previously valid theme it was trying to replace.
  assertInjectable(name, tokens)

  const storage = options.storage ?? localStorageAdapter

  // removeTheme will also wipe the persisted entry — but only from the
  // SAME storage we're about to write to (consistent backend usage).
  removeTheme(name, { storage })
  injectStyleTag(name, tokens, { styleNonce: options.styleNonce })

  if (options.persist !== false)
    writePersistedTheme(storage, name, tokens)
}

export function removeTheme(name: string, options: RemoveThemeOptions = {}): void {
  const existing = styleTags.get(name)
  if (existing) {
    existing.remove()
    styleTags.delete(name)
  }
  removePersistedTheme(options.storage ?? localStorageAdapter, name)
}

export function listThemes(): string[] {
  return Array.from(styleTags.keys())
}

export function hasTheme(name: string): boolean {
  return styleTags.has(name)
}

/**
 * Re-inject persisted runtime themes from storage. Idempotent — skips
 * names that already have a <style> tag in the DOM. Call before applying
 * an override that targets a persisted theme; otherwise the cascade has
 * no matching block and the page flashes unstyled.
 *
 * ThemeController calls this automatically on construct (opt out via
 * `hydrateThemes: false`).
 */
export function hydratePersistedThemes(options: HydrateOptions = {}): void {
  const storage = options.storage ?? localStorageAdapter
  const persisted = readPersistedThemes(storage)
  for (const [name, tokens] of Object.entries(persisted)) {
    const existing = styleTags.get(name)
    if (!existing || (options.styleNonce && existing.nonce !== options.styleNonce)) {
      // A poisoned entry (something wrote to storage directly, or data
      // persisted before the injection guard existed) must not break boot —
      // skip it; every other theme still hydrates.
      try {
        injectStyleTag(name, tokens, { styleNonce: options.styleNonce })
      }
      catch {}
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Internal — DOM
// ────────────────────────────────────────────────────────────────────

interface InjectStyleTagOptions {
  styleNonce?: string
}

function injectStyleTag(name: string, tokens: ThemeTokens, options: InjectStyleTagOptions = {}): void {
  // The single chokepoint that turns tokens into CSS text — defineTheme
  // validated already, but hydration feeds persisted (storage-writable) data
  // through here too, so the guard lives at the write itself.
  assertInjectable(name, tokens)
  const id = `${STYLE_ID_PREFIX}${name}`

  // The bootstrap script (anti-FOUC) injects the same <style> in <head> before
  // React boots. If we re-inject blindly, we'd end up with two tags sharing
  // the same id — the second would be valid but removeTheme would only know
  // about one. Reuse any pre-existing element to keep the DOM canonical.
  const existing = document.getElementById(id)
  const styleNonce = options.styleNonce ?? (existing instanceof HTMLStyleElement ? existing.nonce : undefined)
  if (existing instanceof HTMLStyleElement) {
    existing.remove()
  }

  const decls = Object.entries(tokens)
    .map(([key, val]) => `  --${PREFIX}-color-${key}: ${val};`)
    .join('\n')

  const style = document.createElement('style')
  style.id = id
  if (styleNonce)
    style.nonce = styleNonce
  // Selector wrapped in `:where()` for specificity (0,0,0) — consumer overrides
  // with any class win for free. The baked `theme/color.css` is wrapped in
  // `@layer quanta-theme`, while this runtime-injected style is unlayered. Per the
  // CSS Cascade Layers spec, unlayered rules always beat layered rules
  // regardless of source order or specificity — so this runtime rule wins the
  // cascade at first paint even though Vite injects `theme/color.css` later
  // in DOM order. No specificity-wars, no FOUC.
  style.textContent = `:where([data-theme="${name}"]) {\n${decls}\n}`
  document.head.appendChild(style)
  styleTags.set(name, style)
}

// ────────────────────────────────────────────────────────────────────
// Internal — storage
// ────────────────────────────────────────────────────────────────────

function readPersistedThemes(storage: ThemeStorage): Record<string, ThemeTokens> {
  const raw = storage.get(THEMES_STORAGE_KEY)
  if (!raw)
    return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {}
    return parsed as Record<string, ThemeTokens>
  }
  catch {
    return {}
  }
}

function writePersistedTheme(storage: ThemeStorage, name: string, tokens: ThemeTokens): void {
  const all = readPersistedThemes(storage)
  all[name] = tokens
  storage.set(THEMES_STORAGE_KEY, JSON.stringify(all))
}

function removePersistedTheme(storage: ThemeStorage, name: string): void {
  const all = readPersistedThemes(storage)
  if (!(name in all))
    return
  delete all[name]
  if (Object.keys(all).length === 0)
    storage.remove(THEMES_STORAGE_KEY)
  else
    storage.set(THEMES_STORAGE_KEY, JSON.stringify(all))
}
