type ProxyOptions = Readonly<{
  configuredUrl: string | undefined
  responseHeaders: Readonly<Record<string, string>>
}>

type LocalRegistryProxy = (
  request: Request,
  requestUrl: URL,
) => Promise<Response | undefined>

const routePrefix = "/api/registry"
const maxRequestBytes = 64 * 1024
const allowedMethods = new Map<string, string>([
  ["/v1/auth/login", "POST"],
  ["/v1/auth/signup", "POST"],
  ["/v1/auth/verify", "POST"],
  ["/v1/auth/logout", "POST"],
  ["/v1/auth/me", "GET"],
  ["/v1/marketplace/stats", "GET"],
  ["/v1/marketplace/seller/sales/sessions", "GET"],
  ["/v1/marketplace/seller/sales/earnings", "GET"],
  ["/v1/marketplace/seller/sales/ledger", "GET"],
])

const parseRegistryOrigin = (configured: string): URL => {
  const url = new URL(configured)
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" ||
    url.hostname === "[::1]"
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("ATM_LOCAL_REGISTRY_URL must use HTTPS or a loopback host")
  }
  if (
    url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error("ATM_LOCAL_REGISTRY_URL must be an origin without credentials or a path")
  }
  return url
}

const proxyError = (
  responseHeaders: Readonly<Record<string, string>>,
  status: number,
  code: string,
): Response => Response.json(
  { error: code },
  { headers: { ...responseHeaders, "cache-control": "no-store" }, status },
)

export const createLocalRegistryProxy = (
  options: ProxyOptions,
): LocalRegistryProxy | undefined => {
  if (options.configuredUrl === undefined || options.configuredUrl === "") return undefined
  const registryOrigin = parseRegistryOrigin(options.configuredUrl)

  return async (request, requestUrl) => {
    if (!requestUrl.pathname.startsWith(`${routePrefix}/`)) return undefined
    const registryPath = requestUrl.pathname.slice(routePrefix.length)
    if (allowedMethods.get(registryPath) !== request.method) return undefined

    const body = request.method === "GET" ? undefined : await request.arrayBuffer()
    if (body !== undefined && body.byteLength > maxRequestBytes) {
      return proxyError(options.responseHeaders, 413, "payload_too_large")
    }
    const headers = new Headers()
    for (const name of ["accept", "authorization", "content-type"]) {
      const value = request.headers.get(name)
      if (value !== null) headers.set(name, value)
    }

    try {
      const upstreamUrl = new URL(`${registryPath}${requestUrl.search}`, registryOrigin)
      const upstream = await fetch(upstreamUrl, {
        body,
        headers,
        method: request.method,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      })
      return new Response(await upstream.arrayBuffer(), {
        headers: {
          ...options.responseHeaders,
          "cache-control": "no-store",
          "content-type": upstream.headers.get("content-type") ??
            "application/json; charset=utf-8",
        },
        status: upstream.status,
      })
    } catch {
      return proxyError(options.responseHeaders, 502, "registry_unavailable")
    }
  }
}
