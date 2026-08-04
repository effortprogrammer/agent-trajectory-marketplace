/**
 * Low-level HTTP request/response shape used by HTTP-based adapters. Kept
 * deliberately small and JSON-serializable so it survives Comlink/iframe
 * boundaries. Non-HTTP adapters (websocket, in-process) need not use it.
 */
export interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  headers?: Record<string, string>
  /** Cancels the in-flight request. Not serializable — strip before a Comlink/iframe hop. */
  signal?: AbortSignal
}

export interface TransportResponse {
  status: number
  body: unknown
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>
