import type { OptionalHeaderSource, RequiredHeaderSource } from '../headers'
import type { FnfObservabilityOptions } from '../observability'
import type { Transport } from '../transport'
import type { LlmBackend, LlmCompleteRequest, LlmCompletion, LlmDelta, LlmMessage, LlmToolCall } from './backend'
import { ApiJobError } from '../errors'
import { authorizationHeader, cleanHeaders, optionalNamedHeader } from '../headers'
import { observeEvent } from '../observability'
import { createFetchTransport } from '../workflow-platform/fetch-transport'
import { errorFromLlmResponse } from './errors'

export interface LlmClientOptions {
  /**
   * Gateway LLM mount WITHOUT the `/v1` suffix — the client appends
   * `/v1/chat/completions` and `/v1/models` itself. For CF-Worker apps this is
   * the EXTERNAL gateway, e.g. `https://fnf-api-gw.higgsfield.ai/llm`
   * (dev: `https://dev-fnf-api-gw.higgsfield.ai/llm`). Trailing slash trimmed.
   */
  baseUrl: string
  /** Same token source the WFP adapter uses; sent as `Authorization: Bearer`. */
  getToken?: () => Promise<string | null>
  /** Sent as `hf-user-id` (internal-gateway identity; ignored externally). */
  userId?: RequiredHeaderSource
  /** Sent as `hf-workspace-id`. */
  workspaceId?: OptionalHeaderSource
  /** Sent as `hf-app-id` (observability tag). */
  appId?: OptionalHeaderSource
  fetch?: typeof globalThis.fetch
  /**
   * Inject a transport (tests / custom envs). Covers `complete`/`listModels`
   * ONLY — `stream` always uses `fetch` because the Transport shape is
   * JSON-request/response by design and SSE is not.
   */
  transport?: Transport
  /**
   * Observes the JSON paths (`complete`/`listModels`) as full start→success/
   * error spans via the observed Transport. The SSE `stream` path bypasses the
   * Transport (fetch, not a Transport call), so it emits `fnf.llm.stream`
   * `start`/`error` EVENTS only — deliberately NO success/duration span: the
   * iterator is lazy, so there is no natural completion point to close a span
   * without misattributing consumer time. Full stream telemetry (a
   * span closed on stream end) is a follow-up.
   */
  observability?: FnfObservabilityOptions
}

export function createLlmClient(options: LlmClientOptions): LlmBackend {
  const headers = async () => cleanHeaders({
    ...(await authorizationHeader(options.getToken)),
    ...(await optionalNamedHeader('hf-user-id', options.userId)),
    ...(await optionalNamedHeader('hf-workspace-id', options.workspaceId)),
    ...(await optionalNamedHeader('hf-app-id', options.appId)),
  })
  const transport = options.transport ?? createFetchTransport({
    baseUrl: options.baseUrl,
    headers,
    fetch: options.fetch,
    observability: options.observability,
  })

  async function send(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const res = await transport({ method, path, body, ...(signal ? { signal } : {}) })
    const err = errorFromLlmResponse(res.status, res.body)
    if (err)
      throw err
    return res.body
  }

  return {
    async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
      const body = (await send('POST', '/v1/chat/completions', wireBody(req, false), req.signal) ?? {}) as CompletionWire
      const choice = body.choices?.[0]
      return {
        content: choice?.message?.content ?? '',
        toolCalls: (choice?.message?.tool_calls ?? []).map(toToolCall),
        finishReason: choice?.finish_reason ?? '',
        usage: {
          promptTokens: body.usage?.prompt_tokens ?? 0,
          completionTokens: body.usage?.completion_tokens ?? 0,
        },
      }
    },

    async* stream(req: LlmCompleteRequest): AsyncIterable<LlmDelta> {
      const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
      // Start/error events only — no success span (lazy iterator; see the
      // `observability` option JSDoc). One `try` covers BOTH throw paths:
      // pre-stream HTTP envelope and a mid-stream `data:{"error"}` (raised by
      // `chunkToDeltas`) / abort.
      observeEvent(options.observability, 'fnf.llm.stream', { model: req.model }, { phase: 'start' })
      try {
        const res = await doFetch(`${options.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await headers()) },
          body: JSON.stringify(wireBody(req, true)),
          ...(req.signal ? { signal: req.signal } : {}),
        })
        // Pre-stream failures are plain HTTP error envelopes — thrown before the
        // iterator yields anything.
        if (!res.ok || !res.body) {
          let parsed: unknown
          try {
            parsed = await res.json()
          }
          catch {
            parsed = undefined
          }
          throw errorFromLlmResponse(res.status, parsed)
            ?? new ApiJobError('llm_gateway_error', `LLM gateway error (HTTP ${res.status})`, { status: res.status })
        }
        for await (const data of sseData(res.body, req.signal)) {
          if (data === '[DONE]')
            return
          let chunk: ChunkWire
          try {
            chunk = JSON.parse(data) as ChunkWire
          }
          catch {
            continue // tolerate keep-alive noise; real protocol errors surface as stream end
          }
          yield* chunkToDeltas(chunk)
        }
      }
      catch (error) {
        observeEvent(options.observability, 'fnf.llm.stream', { model: req.model }, { phase: 'error', error })
        throw error
      }
    },

    async listModels(): Promise<string[]> {
      const body = (await send('GET', '/v1/models') ?? {}) as { data?: Array<{ id?: string }> }
      return (body.data ?? []).map(m => m.id ?? '').filter(Boolean)
    },
  }
}

// ── wire shaping ──

interface CompletionWire {
  choices?: Array<{ message?: { content?: string | null, tool_calls?: ToolCallWire[] }, finish_reason?: string }>
  usage?: { prompt_tokens?: number, completion_tokens?: number }
}
interface ToolCallWire { id?: string, function?: { name?: string, arguments?: string } }
interface ChunkWire {
  choices?: Array<{
    delta?: { content?: string, tool_calls?: Array<{ index?: number, id?: string, function?: { name?: string, arguments?: string } }> }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number, completion_tokens?: number }
  error?: { message?: string, type?: string, code?: string }
}

function toToolCall(tc: ToolCallWire): LlmToolCall {
  return { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' }
}

function wireBody(req: LlmCompleteRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, messages: req.messages.map(wireMessage) }
  if (stream)
    body.stream = true
  if (req.maxTokens !== undefined)
    body.max_tokens = req.maxTokens
  if (req.temperature !== undefined)
    body.temperature = req.temperature
  if (req.tools)
    body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  if (req.toolChoice !== undefined)
    body.tool_choice = typeof req.toolChoice === 'string' ? req.toolChoice : { type: 'function', function: { name: req.toolChoice.name } }
  return body
}

/**
 * The SDK's `LlmMessage.tool_calls` is the FLAT `LlmToolCall` shape (id/name/
 * arguments — what `complete()` hands back), so replaying an assistant turn
 * into the next request must re-nest it into the OpenAI wire shape.
 */
function wireMessage(m: LlmMessage): unknown {
  if (!m.tool_calls)
    return m
  return {
    ...m,
    tool_calls: m.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
  }
}

/**
 * One wire chunk → zero or more `LlmDelta`s, throwing on an in-band error
 * event (`data: {"error":{...}}` — the gateway's mid-stream failure shape;
 * status 502 is synthetic since the HTTP exchange already succeeded).
 * A chunk's `delta.tool_calls` is an ARRAY of fragments — `LlmDelta` carries
 * one `toolCallDelta`, so each fragment becomes its own delta (content first,
 * finish/usage last).
 */
function chunkToDeltas(chunk: ChunkWire): LlmDelta[] {
  if (chunk.error)
    throw errorFromLlmResponse(502, { error: chunk.error })
  const choice = chunk.choices?.[0]
  const out: LlmDelta[] = []
  if (choice?.delta?.content)
    out.push({ content: choice.delta.content })
  for (const tc of choice?.delta?.tool_calls ?? []) {
    out.push({
      toolCallDelta: {
        index: tc.index ?? 0,
        ...(tc.id !== undefined ? { id: tc.id } : {}),
        ...(tc.function?.name !== undefined ? { name: tc.function.name } : {}),
        ...(tc.function?.arguments !== undefined ? { argumentsDelta: tc.function.arguments } : {}),
      },
    })
  }
  const tail: LlmDelta = {}
  if (choice?.finish_reason)
    tail.finishReason = choice.finish_reason
  if (chunk.usage)
    tail.usage = { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 }
  if (tail.finishReason !== undefined || tail.usage !== undefined)
    out.push(tail)
  return out
}

// ── SSE reader: yields the payload after each `data: ` line ──

async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      if (signal?.aborted)
        throw new DOMException('aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done)
        return
      buf += decoder.decode(value, { stream: true })
      for (;;) {
        const nl = buf.indexOf('\n\n')
        if (nl < 0)
          break
        const frame = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: '))
            yield line.slice(6)
        }
      }
    }
  }
  finally {
    // Cancel (not just release) so early exits — [DONE], abort, consumer
    // break — actually release the underlying connection.
    try {
      await reader.cancel()
    }
    catch {
      // already errored/closed — nothing to release
    }
    reader.releaseLock()
  }
}
