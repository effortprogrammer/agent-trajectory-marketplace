import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// @testing-library/react v16 auto-registers cleanup() after each test when it
// detects a global afterEach. Vitest does not expose afterEach as a global
// (globals: false), so we register it explicitly here.
afterEach(cleanup)

// Radix relies on a handful of DOM APIs that happy-dom does not implement.
// Polyfill them so menu open/close and focus management work under test.
const proto = Element.prototype as unknown as Record<string, unknown>
proto.hasPointerCapture ??= () => false
proto.setPointerCapture ??= () => {}
proto.releasePointerCapture ??= () => {}
proto.scrollIntoView ??= () => {}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
