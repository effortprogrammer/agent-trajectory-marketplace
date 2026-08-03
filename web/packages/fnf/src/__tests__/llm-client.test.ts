import type { Transport } from '../transport'
import { describe, expect, it, vi } from 'vitest'
import { createLlmClient } from '../llm/client'

function completionBody(content: string) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    model: 'claude-sonnet-4-6',
    choices: [{ index: 0, message: { role: 'assistant', content, tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } }] }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }
}

describe('createLlmClient.complete', () => {
  it('shapes the request and normalizes the completion', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, body: completionBody('hi') }))
    const client = createLlmClient({ baseUrl: 'https://gw.example', transport })

    const res = await client.complete({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 64,
      temperature: 0.2,
      toolChoice: { name: 'f' },
      tools: [{ name: 'f', parameters: { type: 'object' } }],
    })

    const sent = transport.mock.calls[0][0]
    expect(sent.method).toBe('POST')
    expect(sent.path).toBe('/v1/chat/completions')
    const body = sent.body as Record<string, unknown>
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.stream).toBeUndefined()
    expect(body.max_tokens).toBe(64)
    expect(body.temperature).toBe(0.2)
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'f' } })
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'f', description: undefined, parameters: { type: 'object' } } }])

    expect(res.content).toBe('hi')
    expect(res.toolCalls).toEqual([{ id: 't1', name: 'f', arguments: '{}' }])
    expect(res.finishReason).toBe('stop')
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 2 })
  })

  it('maps replayed assistant tool_calls to the OpenAI wire shape', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, body: completionBody('ok') }))
    const client = createLlmClient({ baseUrl: 'https://gw.example', transport })

    await client.complete({
      model: 'm',
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'f', arguments: '{"a":1}' }] },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    })

    const body = transport.mock.calls[0][0].body as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0].tool_calls).toEqual([{ id: 't1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }])
    expect(body.messages[1]).toEqual({ role: 'tool', content: 'result', tool_call_id: 't1' })
  })

  it('throws the mapped catalog error on 402', async () => {
    const transport: Transport = async () => ({ status: 402, body: { error: { message: 'no credits', code: 'insufficient_credits' } } })
    const client = createLlmClient({ baseUrl: 'https://gw.example', transport })
    await expect(client.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
      .rejects
      .toMatchObject({ code: 'out_of_credits', status: 402 })
  })
})

describe('createLlmClient.listModels', () => {
  it('unwraps the OpenAI list shape', async () => {
    const transport: Transport = async () => ({ status: 200, body: { object: 'list', data: [{ id: 'a' }, { id: 'b' }] } })
    const client = createLlmClient({ baseUrl: 'https://gw.example', transport })
    expect(await client.listModels()).toEqual(['a', 'b'])
  })
})

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events)
        controller.enqueue(new TextEncoder().encode(`data: ${e}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/**
 * Enqueue raw byte chunks verbatim — lets a test control exactly where the
 * transport boundaries fall (mid-frame splits, multiple frames per read),
 * which `sseResponse` (one frame per chunk) cannot.
 */
function rawByteResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks)
        controller.enqueue(new TextEncoder().encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('createLlmClient.stream', () => {
  it('yields deltas and the final usage chunk, then completes', async () => {
    const chunks = [
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'he' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '' } }] }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } }),
      '[DONE]',
    ]
    const fetchMock = vi.fn(async () => sseResponse(chunks))
    const client = createLlmClient({ baseUrl: 'https://gw.example', fetch: fetchMock, getToken: async () => 'tok' })

    const seen: unknown[] = []
    for await (const d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
      seen.push(d)

    expect(seen[0]).toEqual({ content: 'he' })
    expect(seen[1]).toEqual({ toolCallDelta: { index: 0, id: 'c1', name: 'f', argumentsDelta: '' } })
    expect(seen[2]).toEqual({ toolCallDelta: { index: 0, argumentsDelta: '{"a":1}' } })
    expect(seen[3]).toEqual({ finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 1 } })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example/v1/chat/completions')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
    expect(JSON.parse(init.body as string).stream).toBe(true)
  })

  it('throws the mapped error when the stream endpoint rejects', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'nope', code: 'rate_limited' } }), { status: 429 }))
    const client = createLlmClient({ baseUrl: 'https://gw.example', fetch: fetchMock })
    const iterate = async () => {
      for await (const _d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) { /* drain */ }
    }
    await expect(iterate()).rejects.toMatchObject({ code: 'rate_limit', status: 429 })
  })

  it('throws the mapped error on a MID-stream error event, after earlier deltas', async () => {
    const chunks = [
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'he' }, finish_reason: null }] }),
      JSON.stringify({ error: { message: 'stream blew up', code: 'upstream_error' } }),
    ]
    const fetchMock = vi.fn(async () => sseResponse(chunks))
    const client = createLlmClient({ baseUrl: 'https://gw.example', fetch: fetchMock })

    const seen: unknown[] = []
    const iterate = async () => {
      for await (const d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
        seen.push(d)
    }
    await expect(iterate()).rejects.toMatchObject({ code: 'upstream_error', message: 'stream blew up' })
    expect(seen).toEqual([{ content: 'he' }])
  })

  it('aborts via the request signal', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] })}\n\n`))
          signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      }), { status: 200 })
    })
    const client = createLlmClient({ baseUrl: 'https://gw.example', fetch: fetchMock })
    const ac = new AbortController()
    const iterate = async () => {
      for await (const d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }], signal: ac.signal })) {
        if (d.content === 'x')
          ac.abort()
      }
    }
    await expect(iterate()).rejects.toThrow(/abort/i)
  })

  it('reassembles a frame split across read() boundaries', async () => {
    // The `data: {json}\n\n` frame arrives in two reads mid-payload — the
    // reader must buffer across reads and parse exactly one delta.
    const frame = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'split' }, finish_reason: null }] })}\n\n`
    const cut = 10 // mid-JSON, well before the `\n\n`
    const fetchMock = vi.fn(async () => rawByteResponse([frame.slice(0, cut), frame.slice(cut)]))
    const client = createLlmClient({ baseUrl: 'https://gw.example', fetch: fetchMock })

    const seen: unknown[] = []
    for await (const d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
      seen.push(d)

    expect(seen).toEqual([{ content: 'split' }])
  })

  it('parses two complete frames packed into a single read(), in order', async () => {
    const one = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }] })}\n\n`
    const two = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'b' }, finish_reason: null }] })}\n\n`
    const fetchMock = vi.fn(async () => rawByteResponse([one + two])) // both frames in ONE chunk
    const client = createLlmClient({ baseUrl: 'https://gw.example', fetch: fetchMock })

    const seen: unknown[] = []
    for await (const d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
      seen.push(d)

    expect(seen).toEqual([{ content: 'a' }, { content: 'b' }])
  })
})

describe('createLlmClient.stream observability', () => {
  it('emits a start event before the fetch', async () => {
    const events: Array<{ name: string, phase: string }> = []
    const fetchMock = vi.fn(async () => sseResponse([JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }), '[DONE]']))
    const client = createLlmClient({
      baseUrl: 'https://gw.example',
      fetch: fetchMock,
      observability: { observer: e => void events.push({ name: e.name, phase: e.phase }) },
    })

    for await (const _d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) { /* drain */ }

    expect(events).toContainEqual({ name: 'fnf.llm.stream', phase: 'start' })
    // Lazy iterator: deliberately no success/duration span (see stream() JSDoc).
    expect(events.some(e => e.phase === 'success')).toBe(false)
  })

  it('emits an error event on a pre-stream HTTP rejection', async () => {
    const events: Array<{ phase: string, code?: string }> = []
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'nope', code: 'rate_limited' } }), { status: 429 }))
    const client = createLlmClient({
      baseUrl: 'https://gw.example',
      fetch: fetchMock,
      observability: { observer: e => void events.push({ phase: e.phase, code: e.error?.code }) },
    })
    const iterate = async () => {
      for await (const _d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) { /* drain */ }
    }
    await expect(iterate()).rejects.toMatchObject({ code: 'rate_limit' })
    expect(events).toContainEqual({ phase: 'error', code: 'rate_limit' })
  })

  it('emits an error event on a mid-stream error event', async () => {
    const events: Array<{ phase: string, code?: string }> = []
    const chunks = [
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'he' }, finish_reason: null }] }),
      JSON.stringify({ error: { message: 'stream blew up', code: 'upstream_error' } }),
    ]
    const fetchMock = vi.fn(async () => sseResponse(chunks))
    const client = createLlmClient({
      baseUrl: 'https://gw.example',
      fetch: fetchMock,
      observability: { observer: e => void events.push({ phase: e.phase, code: e.error?.code }) },
    })
    const iterate = async () => {
      for await (const _d of client.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) { /* drain */ }
    }
    await expect(iterate()).rejects.toMatchObject({ code: 'upstream_error' })
    expect(events).toContainEqual({ phase: 'error', code: 'upstream_error' })
  })
})
