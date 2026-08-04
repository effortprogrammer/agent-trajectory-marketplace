import { describe, expect, it } from 'vitest'
import { ApiJobError, OutOfCreditsError, RateLimitError } from '../errors'
import { errorFromLlmResponse, stampLlmStatus } from '../llm/errors'

describe('errorFromLlmResponse', () => {
  it('maps 402 to the existing out_of_credits error, gateway detail on data', () => {
    const err = errorFromLlmResponse(402, { error: { message: 'not enough credits', type: 'billing_error', code: 'insufficient_credits' } })
    expect(err).toBeInstanceOf(OutOfCreditsError)
    expect(err!.status).toBe(402)
    // Canonical class message stays; the gateway's verbatim detail rides data.
    expect(err!.message).toBe('Not enough credits')
    expect((err as OutOfCreditsError).data).toMatchObject({
      gateway: { message: 'not enough credits', code: 'insufficient_credits' },
    })
  })

  it('maps 429 to the existing rate_limit error, gateway detail on data', () => {
    const err = errorFromLlmResponse(429, { error: { message: 'too many requests', type: 'rate_limit_error', code: 'rate_limited' } })
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).data).toMatchObject({
      gateway: { message: 'too many requests', code: 'rate_limited' },
    })
  })

  it('never overwrites a class-pinned status (stamp fills null only)', () => {
    class PinnedStubError extends ApiJobError {
      constructor() { super('pinned_stub', 'pinned', { status: 409 }) }
    }
    expect(stampLlmStatus(new PinnedStubError(), 502).status).toBe(409)
    // and the fill half of the contract, for symmetry
    expect(stampLlmStatus(new ApiJobError('unpinned', 'x'), 502).status).toBe(502)
  })

  it('carries the gateway code for other errors', () => {
    const err = errorFromLlmResponse(404, { error: { message: 'model x not available', type: 'invalid_request_error', code: 'model_not_found' } })
    expect(err!.code).toBe('model_not_found')
    expect(err!.status).toBe(404)
    expect(err!.message).toContain('model x')
  })

  it('survives a non-OpenAI-shaped body', () => {
    const err = errorFromLlmResponse(502, 'bad gateway')
    expect(err!.code).toBe('llm_gateway_error')
    expect(err!.status).toBe(502)
  })

  it('returns null on 2xx', () => {
    expect(errorFromLlmResponse(200, {})).toBeNull()
  })
})
