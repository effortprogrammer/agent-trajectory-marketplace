import { resolve } from "node:path"

import {
  createMarketplaceHandler,
  marketplaceSecurityHeaders,
  type MarketplaceHandler,
} from "../../../web/marketplace-handler"
import {
  createLocalRegistryProxy,
  type UpstreamFetch,
} from "../../../web/local-registry-proxy"

export const publicRoot = resolve(import.meta.dir, "../../..")
export const testRevision = "0123456789abcdef0123456789abcdef01234567"

type HandlerOptions = Readonly<{
  publicStatsFetch?: UpstreamFetch
  publicStatsUrl?: string
  registryFetch?: UpstreamFetch
  registryUrl?: string
  revision?: string | null
}>

export const unexpectedFetch: UpstreamFetch = () =>
  Promise.reject(new Error("unexpected upstream request"))

export const createTestHandler = (
  options: HandlerOptions = {},
): Promise<MarketplaceHandler> => createMarketplaceHandler({
  localPublicStatsUpstream:
    options.publicStatsUrl === undefined ? undefined : new URL(options.publicStatsUrl),
  localRegistryProxy: createLocalRegistryProxy({
    configuredUrl: options.registryUrl,
    responseHeaders: marketplaceSecurityHeaders,
    upstreamFetch: options.registryFetch ?? unexpectedFetch,
  }),
  originRevision: options.revision === null
    ? undefined
    : options.revision ?? testRevision,
  publicStatsFetch: options.publicStatsFetch ?? unexpectedFetch,
  root: `${resolve(publicRoot, "web")}/`,
})

export const awaitSignal = async <Value>(
  signal: Promise<Value>,
): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("expected handler event did not arrive")),
      2_000,
    )
  })
  try {
    return await Promise.race([signal, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
