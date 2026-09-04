import type {
  LocalRegistryProxy,
  UpstreamFetch,
} from "./local-registry-proxy"

type Asset = Readonly<{
  cacheControl: string
  file: string
  type: string
}>

export type MarketplaceHandlerOptions = Readonly<{
  localPublicStatsUpstream: URL | undefined
  localRegistryProxy: LocalRegistryProxy | undefined
  originRevision: string | undefined
  publicStatsFetch: UpstreamFetch
  root: string
}>

export type MarketplaceHandler = (request: Request) => Promise<Response>

const canonicalOrigin = "https://getatm.io"
const legacyMarketplaceHost = "marketplace.getatm.io"
const originRevisionPattern = /^[a-f0-9]{40}$/

export const marketplaceSecurityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' https://gateway.getatm.io",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const

const fixedAssets = new Map<string, Asset>([
  ["/", { cacheControl: "no-store", file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { cacheControl: "no-store", file: "index.html", type: "text/html; charset=utf-8" }],
  ["/legal/account-terms/2026-08-28", {
    cacheControl: "public, max-age=31536000, immutable",
    file: "legal-account-terms-2026-08-28.html",
    type: "text/html; charset=utf-8",
  }],
  ["/legal/account-privacy/2026-08-28", {
    cacheControl: "public, max-age=31536000, immutable",
    file: "legal-account-privacy-2026-08-28.html",
    type: "text/html; charset=utf-8",
  }],
  ["/legal/assets/2026-08-28.css", {
    cacheControl: "public, max-age=31536000, immutable",
    file: "legal-2026-08-28.css",
    type: "text/css; charset=utf-8",
  }],
  ["/console.js", {
    cacheControl: "no-store",
    file: "console.js",
    type: "text/javascript; charset=utf-8",
  }],
  ["/agent-onboarding.md", {
    cacheControl: "no-store",
    file: "agent-onboarding.md",
    type: "text/markdown; charset=utf-8",
  }],
  ["/robots.txt", {
    cacheControl: "public, max-age=300",
    file: "robots.txt",
    type: "text/plain; charset=utf-8",
  }],
])

const fingerprintedAssetSpecs = [
  { file: "marketplace.css", type: "text/css; charset=utf-8" },
  { file: "marketplace.js", type: "text/javascript; charset=utf-8" },
  { file: "console.css", type: "text/css; charset=utf-8" },
  { file: "console.js", type: "text/javascript; charset=utf-8" },
  { file: "console-contract.js", type: "text/javascript; charset=utf-8" },
  { file: "payout-console.js", type: "text/javascript; charset=utf-8" },
  { file: "public-payout-capacity.js", type: "text/javascript; charset=utf-8" },
] as const

const createAssetMap = async (root: string): Promise<ReadonlyMap<string, Asset>> => {
  const assets = new Map(fixedAssets)
  for (const asset of fingerprintedAssetSpecs) {
    const extensionOffset = asset.file.lastIndexOf(".")
    if (extensionOffset <= 0) throw new Error(`asset has no extension: ${asset.file}`)
    const bytes = await Bun.file(`${root}${asset.file}`).arrayBuffer()
    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
    const path =
      `/${asset.file.slice(0, extensionOffset)}.${digest}${asset.file.slice(extensionOffset)}`
    assets.set(path, {
      cacheControl: "public, max-age=31536000, immutable",
      file: asset.file,
      type: asset.type,
    })
  }
  return assets
}

const notFound = (): Response =>
  new Response("not found", {
    headers: { ...marketplaceSecurityHeaders, "cache-control": "no-store" },
    status: 404,
  })

const compatibilityRedirect = (url: URL): Response | undefined => {
  if (url.pathname === "/detail.html") {
    return new Response(null, {
      headers: { ...marketplaceSecurityHeaders, location: "/index.html" },
      status: 302,
    })
  }
  if (url.searchParams.get("view") !== "world") return undefined
  return new Response(null, {
    headers: { ...marketplaceSecurityHeaders, location: "/index.html" },
    status: 302,
  })
}

const canonicalHostRedirect = (url: URL): Response | undefined => {
  if (url.hostname !== legacyMarketplaceHost) return undefined
  const canonicalUrl = new URL(canonicalOrigin)
  canonicalUrl.pathname = url.pathname
  canonicalUrl.search = url.search
  return new Response(null, {
    headers: { ...marketplaceSecurityHeaders, location: canonicalUrl.toString() },
    status: 301,
  })
}

const publicStatsResponse = async (
  fetchUpstream: UpstreamFetch,
  upstreamUrl: URL,
  request: Request,
): Promise<Response> => {
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      {
        headers: {
          ...marketplaceSecurityHeaders,
          allow: "GET",
          "cache-control": "no-store",
        },
        status: 405,
      },
    )
  }
  try {
    const upstream = await fetchUpstream(upstreamUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    })
    return new Response(await upstream.arrayBuffer(), {
      headers: {
        ...marketplaceSecurityHeaders,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      status: upstream.status,
    })
  } catch {
    return Response.json(
      { error: "unavailable" },
      {
        headers: { ...marketplaceSecurityHeaders, "cache-control": "no-store" },
        status: 502,
      },
    )
  }
}

export const createMarketplaceHandler = async (
  options: MarketplaceHandlerOptions,
): Promise<MarketplaceHandler> => {
  const assets = await createAssetMap(options.root)
  return async (request) => {
    const url = new URL(request.url)
    const canonicalRedirect = canonicalHostRedirect(url)
    if (canonicalRedirect !== undefined) return canonicalRedirect
    if (url.pathname === "/.well-known/atm-origin-revision") {
      const revision = options.originRevision ?? ""
      if (!originRevisionPattern.test(revision)) {
        return Response.json(
          { error: "unavailable" },
          {
            headers: { ...marketplaceSecurityHeaders, "cache-control": "no-store" },
            status: 503,
          },
        )
      }
      return Response.json(
        { revision },
        {
          headers: {
            ...marketplaceSecurityHeaders,
            "cache-control": "no-store",
            "x-atm-origin-revision": revision,
          },
        },
      )
    }
    if (url.pathname === "/favicon.ico") {
      return new Response(null, { headers: marketplaceSecurityHeaders, status: 204 })
    }
    const registryResponse = await options.localRegistryProxy?.(request, url)
    if (registryResponse !== undefined) return registryResponse
    if (
      url.pathname === "/api/public-stats"
      && options.localPublicStatsUpstream !== undefined
    ) {
      return publicStatsResponse(
        options.publicStatsFetch,
        options.localPublicStatsUpstream,
        request,
      )
    }
    const redirect = compatibilityRedirect(url)
    if (redirect !== undefined) return redirect
    const acceptsMarketingQuery =
      url.pathname === "/" || url.pathname === "/index.html"
    const asset =
      url.search === "" || acceptsMarketingQuery
        ? assets.get(url.pathname)
        : undefined
    if (asset === undefined) return notFound()
    const file = Bun.file(`${options.root}${asset.file}`)
    if (!(await file.exists())) return notFound()
    return new Response(file, {
      headers: {
        ...marketplaceSecurityHeaders,
        "cache-control": asset.cacheControl,
        "content-type": asset.type,
      },
    })
  }
}
