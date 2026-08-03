'use client'

import type { ExternalStore } from './external-store'
import { useSyncExternalStore } from 'react'

/**
 * Bind any controller from this package (or your own `ExternalStore`
 * subclass) to a component: re-renders on every `commit()`, returns the
 * controller itself. This is the escape hatch the `use*` hooks are built on —
 * construct a controller yourself (module scope, context, a pool) and bind it
 * wherever it's read.
 */
export function useStore<T extends ExternalStore>(store: T): T {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  return store
}
