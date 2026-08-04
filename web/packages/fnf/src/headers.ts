/** Shared auth and identity header construction for HTTP adapters. */

type MaybePromise<T> = T | Promise<T>
/** Header value that must resolve to a string: static, or a lazy/async accessor. */
export type RequiredHeaderSource = string | (() => MaybePromise<string>)
/** Header value that may be absent: static string, or a lazy/async accessor returning null/undefined to omit the header. */
export type OptionalHeaderSource = string | (() => MaybePromise<string | null | undefined>)

export async function authorizationHeader(getToken: (() => Promise<string | null>) | undefined): Promise<Record<string, string | undefined>> {
  const token = await getToken?.()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function optionalNamedHeader(name: string, source: OptionalHeaderSource | undefined): Promise<Record<string, string | undefined>> {
  const value = typeof source === 'function' ? await source() : source
  return typeof value === 'string' && value.trim() !== '' ? { [name]: value } : {}
}

export function cleanHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value)
      out[key] = value
  }
  return out
}
