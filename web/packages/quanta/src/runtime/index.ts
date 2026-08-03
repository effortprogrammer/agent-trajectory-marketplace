export { bootstrapScript } from './bootstrap.ts'
export type { BootstrapOptions } from './bootstrap.ts'

export { readInitialThemeState, ThemeController } from './controller.ts'
export type {
  ReadInitialThemeStateOptions,
  ThemeControllerOptions,
  ThemePref,
  ThemeState,
  ThemeSubscriber,
} from './controller.ts'

export {
  defineTheme,
  hasTheme,
  hydratePersistedThemes,
  listThemes,
  removeTheme,
} from './define-theme.ts'
export type {
  DefineThemeOptions,
  HydrateOptions,
  RemoveThemeOptions,
  ThemeTokens,
} from './define-theme.ts'

export {
  localStorageAdapter,
  memoryStorage,
  sessionStorageAdapter,
  urlAdapter,
} from './storage.ts'
export type { ThemeStorage, UrlAdapterOptions } from './storage.ts'
