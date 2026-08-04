import type { BillingContext } from '../errors'
import { ApiJobError, OutOfCreditsError, RateLimitError } from '../errors'

interface OpenAIErrorBody { error?: { message?: string, type?: string, code?: string } }

/** The gateway's verbatim error detail, carried on billing errors as `data.gateway`. */
export interface LlmGatewayErrorDetail { message?: string, code?: string }

/** `data` shape of the billing errors produced by `errorFromLlmResponse`. */
export type LlmBillingErrorData = BillingContext & { gateway?: LlmGatewayErrorDetail }

/**
 * Map a gateway (OpenAI-shaped) error response onto the SDK's ApiJobError
 * catalog. The gateway emits `{"error":{message,type,code}}` bodies — NOT the
 * fnf `detail` shape `errorFromResponse` parses — so the LLM client gets its
 * own thin mapper here rather than routing through `errorFromResponse`.
 *
 * 402/429 reuse the existing billing classes so app-level handling
 * (`err.code === 'out_of_credits'`) works identically for generations and LLM
 * calls; everything else carries the gateway's own `code` verbatim (falling
 * back to `llm_gateway_error` when the body isn't OpenAI-shaped at all, e.g.
 * a raw string/HTML error page from an intermediary proxy).
 *
 * Message-loss trade-off, resolved: the billing classes keep their canonical
 * messages ('Not enough credits' / 'Rate limit reached') so app copy keyed on
 * them stays stable — the gateway's verbatim message/code are NOT dropped but
 * ride on `data.gateway` (`LlmGatewayErrorDetail`), the catalog's usual
 * context carrier, so 402/429 callers can still surface them.
 *
 * Never throws on a malformed/non-JSON body — worst case it falls through to
 * the generic `ApiJobError('llm_gateway_error', ...)` with the raw status.
 */
export function errorFromLlmResponse(status: number, body: unknown): ApiJobError | null {
  if (status >= 200 && status < 300)
    return null
  const detail = (typeof body === 'object' && body !== null ? (body as OpenAIErrorBody).error : undefined) ?? {}
  const message = detail.message ?? `LLM gateway error (HTTP ${status})`
  let err: ApiJobError
  if (status === 402)
    err = attachGatewayDetail(new OutOfCreditsError({}), detail)
  else if (status === 429)
    err = attachGatewayDetail(new RateLimitError({}), detail)
  else
    err = new ApiJobError(detail.code ?? 'llm_gateway_error', message)
  return stampLlmStatus(err, status)
}

/**
 * Stamp the wire status onto the error — but only fill a null one, never
 * overwrite a status the class pinned in its constructor (same contract as
 * `errorFromResponse`'s stamping). Exported as the seam for the
 * status-preservation contract test — a synthetic pre-set-status class has no
 * other way into the mapper.
 */
export function stampLlmStatus<E extends ApiJobError>(err: E, status: number): E {
  if (err.status == null)
    (err as { status?: number }).status = status
  return err
}

/**
 * Preserve the gateway's verbatim message/code on the billing classes, whose
 * constructors fix `message` and take only a `BillingContext`. `data` is the
 * catalog's context carrier and `readonly`, so this is a post-construction
 * attach (mirroring the catalog's own status-stamp cast) rather than an
 * untyped cast into the constructor. Rides `toJSON()` for free via `data`.
 */
function attachGatewayDetail<E extends ApiJobError<BillingContext>>(err: E, detail: LlmGatewayErrorDetail): E {
  if (detail.message === undefined && detail.code === undefined)
    return err
  const gateway: LlmGatewayErrorDetail = {
    ...(detail.message !== undefined ? { message: detail.message } : {}),
    ...(detail.code !== undefined ? { code: detail.code } : {}),
  }
  ;(err as { data?: LlmBillingErrorData }).data = { ...err.data, gateway }
  return err
}
