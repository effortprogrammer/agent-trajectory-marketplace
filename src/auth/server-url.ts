export const authServerUrlErrorCodes = [
  "invalid_server_url",
  "insecure_server_url",
  "invalid_auth_endpoint",
] as const

export type AuthServerUrlErrorCode = (typeof authServerUrlErrorCodes)[number]

export class AuthServerUrlError extends Error {
  readonly name = "AuthServerUrlError"

  constructor(
    readonly code: AuthServerUrlErrorCode,
    message = code,
  ) {
    super(message)
  }
}

export const authEndpointPaths = Object.freeze({
  signup: "/v1/auth/signup",
  login: "/v1/auth/login",
  verify: "/v1/auth/verify",
  me: "/v1/auth/me",
  logout: "/v1/auth/logout",
} as const)

export type AuthEndpoint = keyof typeof authEndpointPaths

const originPattern = /^([a-z][a-z\d+.-]*):\/\//i
const forbiddenControlPattern = /[\u0000-\u0020\u007f]/
const authorityTerminatorPattern = /[/?#]/
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"])

const invalidServerUrl = (): never => {
  throw new AuthServerUrlError("invalid_server_url")
}

const insecureServerUrl = (): never => {
  throw new AuthServerUrlError("insecure_server_url")
}

const isAuthEndpoint = (value: unknown): value is AuthEndpoint =>
  typeof value === "string" && Object.hasOwn(authEndpointPaths, value)

export function normalizeAuthServerUrl(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.trim() !== input ||
    forbiddenControlPattern.test(input)
  ) {
    return invalidServerUrl()
  }

  const scheme = originPattern.exec(input)?.[1]?.toLowerCase()
  if (scheme === undefined) {
    return invalidServerUrl()
  }

  const authorityStart = `${scheme}://`
  const authorityAndSuffix = input.slice(authorityStart.length)
  if (authorityAndSuffix.includes("\\")) {
    return invalidServerUrl()
  }

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error
    }
    return invalidServerUrl()
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return insecureServerUrl()
  }
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.hostname.length === 0) {
    return invalidServerUrl()
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    return invalidServerUrl()
  }

  const suffixIndex = authorityAndSuffix.search(authorityTerminatorPattern)
  if (suffixIndex >= 0 && authorityAndSuffix.slice(suffixIndex) !== "/") {
    return invalidServerUrl()
  }
  if (parsed.protocol === "http:" && !loopbackHosts.has(parsed.hostname.toLowerCase())) {
    return insecureServerUrl()
  }
  return parsed.origin
}

export function authEndpoint(serverUrl: unknown, endpoint: unknown): string {
  if (!isAuthEndpoint(endpoint)) {
    throw new AuthServerUrlError("invalid_auth_endpoint")
  }
  return `${normalizeAuthServerUrl(serverUrl)}${authEndpointPaths[endpoint]}`
}

export const buildAuthEndpoint = authEndpoint
