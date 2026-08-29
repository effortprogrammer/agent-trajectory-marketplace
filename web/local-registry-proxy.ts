import { isValidPayoutOperationId, payoutRequestErrorMessages } from "../src/marketplace/payout-request-contract"

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
const maxResponseBytes = 64 * 1024
const upstreamTimeoutMs = 10_000
const allowedRegistryRoutes: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["/v1/auth/login", new Set(["POST"])],
  ["/v1/auth/signup", new Set(["POST"])],
  ["/v1/auth/verify", new Set(["POST"])],
  ["/v1/auth/logout", new Set(["POST"])],
  ["/v1/auth/me", new Set(["GET"])],
  ["/v1/marketplace/stats", new Set(["GET"])],
  ["/v1/marketplace/seller/sales/sessions", new Set(["GET"])],
  ["/v1/marketplace/seller/sales/earnings", new Set(["GET"])],
  ["/v1/marketplace/seller/sales/ledger", new Set(["GET"])],
  ["/v1/marketplace/seller/payout-request", new Set(["GET", "POST"])],
  ["/v1/marketplace/seller/payout-request/withdraw", new Set(["POST"])],
])
const payoutRequestPaths = new Set([
  "/v1/marketplace/seller/payout-request",
  "/v1/marketplace/seller/payout-request/withdraw",
])
const forwardedHeaderNames = ["accept", "authorization", "content-type", "idempotency-key"] as const

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

class UpstreamResponseTooLargeError extends Error {
  public constructor() {
    super("upstream response exceeds proxy limit")
    this.name = "UpstreamResponseTooLargeError"
  }
}

const readBoundedUpstream = async (upstream: Response): Promise<Buffer> => {
  if (upstream.body === null) return Buffer.alloc(0)
  const reader = upstream.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maxResponseBytes) {
        await reader.cancel()
        throw new UpstreamResponseTooLargeError()
      }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const body = Buffer.alloc(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const methodNotAllowed = (
  responseHeaders: Readonly<Record<string, string>>,
  allow: ReadonlySet<string>,
): Response => Response.json(
  { error: "method_not_allowed" },
  { headers: {
    ...responseHeaders,
    allow: [...allow].join(", "),
    "cache-control": "no-store",
  }, status: 405 },
)

const payoutInvalidRequest = (
  responseHeaders: Readonly<Record<string, string>>,
): Response => Response.json(
  { ok: false, error: { code: "invalid_request", message: payoutRequestErrorMessages.invalid_request } },
  { headers: { ...responseHeaders, "cache-control": "no-store" }, status: 400 },
)

const jsonMediaType = (value: string | null): boolean =>
  value !== null && value.split(";", 1)[0]?.trim().toLowerCase() === "application/json"

const isDuplicatedHeader = (value: string): boolean => value.includes(", ")

const payoutRequestIsValid = (request: Request, body: ArrayBuffer | undefined): boolean => {
  for (const name of forwardedHeaderNames) {
    const value = request.headers.get(name)
    if (value !== null && isDuplicatedHeader(value)) return false
  }
  if (request.method !== "POST") return true
  if (body === undefined || new TextDecoder().decode(body) !== "{}") return false
  if (!jsonMediaType(request.headers.get("content-type"))) return false
  const operationId = request.headers.get("idempotency-key")
  return operationId !== null && isValidPayoutOperationId(operationId)
}

export const createLocalRegistryProxy = (
  options: ProxyOptions,
): LocalRegistryProxy | undefined => {
  if (options.configuredUrl === undefined || options.configuredUrl === "") return undefined
  const registryOrigin = parseRegistryOrigin(options.configuredUrl)

  return async (request, requestUrl) => {
    if (!requestUrl.pathname.startsWith(`${routePrefix}/`)) return undefined
    const registryPath = requestUrl.pathname.slice(routePrefix.length)
    const allowedMethods = allowedRegistryRoutes.get(registryPath)
    if (allowedMethods === undefined) return undefined
    const payoutRequest = payoutRequestPaths.has(registryPath)
    if (!allowedMethods.has(request.method)) {
      // Preserved legacy fall-through for pre-existing routes: unmatched
      // methods surface as the static 404 instead of a method-specific 405.
      if (!payoutRequest) return undefined
      return methodNotAllowed(options.responseHeaders, allowedMethods)
    }

    const body = request.method === "GET" ? undefined : await request.arrayBuffer()
    if (body !== undefined && body.byteLength > maxRequestBytes) {
      return proxyError(options.responseHeaders, 413, "payload_too_large")
    }
    if (payoutRequest && !payoutRequestIsValid(request, body)) {
      return payoutInvalidRequest(options.responseHeaders)
    }

    const headers = new Headers()
    for (const name of forwardedHeaderNames) {
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
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      })
      return new Response(await readBoundedUpstream(upstream), {
        headers: {
          ...options.responseHeaders,
          "cache-control": "no-store",
          "content-type": upstream.headers.get("content-type") ??
            "application/json; charset=utf-8",
        },
        status: upstream.status,
      })
    } catch (error) {
      if (error instanceof UpstreamResponseTooLargeError) {
        return proxyError(options.responseHeaders, 502, "registry_response_too_large")
      }
      return proxyError(options.responseHeaders, 502, "registry_unavailable")
    }
  }
}
