import type { FnfObservabilityOptions } from '../observability'
import type { Transport } from '../transport'
import { withObservedTransport } from '../observability'

type MaybePromise<T> = T | Promise<T>

export interface FetchTransportOptions {
  /** Backend origin, e.g. "https://dev-fnf.higgsfield.ai". Trailing slash is trimmed. */
  baseUrl: string
  /**
   * Static or lazily-resolved headers applied to every request (e.g. auth).
   * A function form supports async sources (rotating secrets, async storage).
   */
  headers?: Record<string, string> | (() => MaybePromise<Record<string, string>>)
  /** Override the fetch implementation (defaults to global fetch). */
  fetch?: typeof globalThis.fetch
  observability?: FnfObservabilityOptions
}

/**
 * Isomorphic Transport over the Fetch API. JSON in, JSON out. Works in Node,
 * the browser, and plugin webviews (Figma) that expose a global fetch. Adobe
 * UXP, which forbids direct fetch from the webview, needs a Comlink adapter
 * instead — this transport is the reference for the fetch-capable environments.
 */
export function createFetchTransport(options: FetchTransportOptions): Transport {
  const base = options.baseUrl.replace(/\/$/, '')
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  const transport: Transport = async (req) => {
    const injected = typeof options.headers === 'function' ? await options.headers() : options.headers ?? {}
    // Headers.set replaces case-insensitively — a consumer passing lowercase
    // 'content-type' overrides the default instead of producing a combined,
    // invalid header (which a plain object spread would).
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const [key, value] of Object.entries(injected))
      headers.set(key, value)
    for (const [key, value] of Object.entries(req.headers ?? {}))
      headers.set(key, value)

    const res = await doFetch(base + req.path, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: req.signal,
    })

    const text = await res.text()
    let body: unknown
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined
    }
    catch {
      body = text
    }
    return { status: res.status, body }
  }
  return options.observability ? withObservedTransport(transport, options.observability) : transport
}
