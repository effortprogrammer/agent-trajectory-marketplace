import { describe, expect, it } from 'vitest'
import {
  AccountSuspendedError,
  ApiJobError,
  ApiMessageError,
  AutoTopUpSuspendedError,
  BatchRateLimitError,
  BillingError,
  errorFromJSON,
  errorFromResponse,
  GraceDailyLimitError,
  IpCheckRateLimitError,
  IpDetectedError,
  JobAbortedError,
  JobInProgressError,
  JobTimeoutError,
  KybVerificationRequiredError,
  MinimumPlanError,
  NotEnoughBoostCreditsError,
  OutOfCreditsError,
  PromptNsfwError,
  RateLimitError,
  UnknownSubmitResponseError,
  ValidationError,
  VpnDetectedError,
  WorkspaceMemberSpendPausedError,
  WorkspaceSelectionRequiredError,
} from '../errors'
import { MediaModerationError, UploadTransferError } from '../media/errors'

describe('errorFromResponse', () => {
  it('returns null for a successful response', () => {
    expect(errorFromResponse(200, { ok: true })).toBeNull()
  })

  it('maps not_enough_credits to OutOfCreditsError carrying the real HTTP status', () => {
    // Both backend not_enough_credits sites emit HTTP 403 (fnf-api
    // src/exceptions/auth.py:71-88, src/exceptions/workspace.py:267-290) —
    // the class must not pin 402 over it.
    const err = errorFromResponse(403, {
      detail: { error_type: 'not_enough_credits', plan_type: 'pro', billing_period: 'monthly', workspace: { type: 'shared', role: 'owner' } },
    })
    expect(err).toBeInstanceOf(OutOfCreditsError)
    expect(err?.code).toBe('out_of_credits')
    expect(err?.status).toBe(403)
    expect((err as OutOfCreditsError).data).toEqual({ plan: 'pro', billingPeriod: 'monthly', team: { workspaceType: 'Shared', userRole: 'Owner' } })

    // the stamped status survives a toJSON round-trip
    const round = errorFromJSON(JSON.parse(JSON.stringify(err!.toJSON())))
    expect(round).toBeInstanceOf(OutOfCreditsError)
    expect(round.status).toBe(403)
  })

  it('lowercases plan_type before casting (shared workspaces send "Team")', () => {
    // fnf-api src/exceptions/workspace.py:260,287 send TeamPlanFactory.team().name = 'Team'
    // (src/types_/team_subscription.py:149-153) — outside the lowercase union as-is.
    const err = errorFromResponse(403, {
      detail: { error_type: 'not_enough_credits', plan_type: 'Team', billing_period: 'monthly', workspace: { type: 'shared', role: 'member' } },
    })
    expect((err as OutOfCreditsError).data?.plan).toBe('team')
  })

  it('maps rate_limit_reached with maxCount + isUnlimited', () => {
    const err = errorFromResponse(429, { detail: { error_type: 'rate_limit_reached', plan_type: 'basic', concurrent_jobs_limit: 3, use_unlim: true } })
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).data).toMatchObject({ plan: 'basic', maxCount: 3, isUnlimited: true })
  })

  it('maps both nsfw (real wire type) and prompt_nsfw (alias) to PromptNsfwError', () => {
    expect(errorFromResponse(400, { detail: { error_type: 'nsfw' } })).toBeInstanceOf(PromptNsfwError)
    expect(errorFromResponse(400, { detail: { error_type: 'prompt_nsfw' } })).toBeInstanceOf(PromptNsfwError)
  })

  it('maps the 422 ip_detected error-body shape to IpDetectedError (not the ValidationError fallback)', () => {
    const err = errorFromResponse(422, { detail: { error_type: 'ip_detected' } })
    expect(err).toBeInstanceOf(IpDetectedError)
    expect(err?.code).toBe('ip_detected')
    expect(err?.status).toBe(422)
    expect(err?.message).toBe('Protected content is not allowed')
    // the backend's message wins when present
    expect(errorFromResponse(422, { detail: { error_type: 'ip_detected', message: 'IP found in media' } })?.message).toBe('IP found in media')
  })

  it('maps ip_check_rate_limit_reached (presign/confirm) to IpCheckRateLimitError', () => {
    const err = errorFromResponse(422, { detail: { error_type: 'ip_check_rate_limit_reached' } })
    expect(err).toBeInstanceOf(IpCheckRateLimitError)
    expect(err?.code).toBe('ip_check_rate_limit_reached')
    expect(err?.message).toMatch(/eligibility check limit/)
  })

  it('collapses the minimum-plan error_types into MinimumPlanError with plan/feature in data', () => {
    // Plans are the backend-named (legacy) values, matching the product's
    // native mapping (fnf-web src/entities/job/error/plan.ts).
    expect((errorFromResponse(402, { detail: { error_type: 'ultimate_plan_required' } }) as MinimumPlanError).data).toEqual({ plan: 'ultimate' })
    expect((errorFromResponse(402, { detail: { error_type: 'job_minimum_pro_plan_required' } }) as MinimumPlanError).data).toEqual({ plan: 'pro' })
    expect((errorFromResponse(402, { detail: { error_type: 'avatar_minimum_pro_plan_required' } }) as MinimumPlanError).data).toEqual({ plan: 'pro', feature: 'avatar' })
    expect((errorFromResponse(402, { detail: { error_type: 'job_minimum_creator_plan_required' } }) as MinimumPlanError).data).toEqual({ plan: 'creator' })
    expect((errorFromResponse(402, { detail: { error_type: 'train_minimum_basic_plan_required' } }) as MinimumPlanError).data).toEqual({ plan: 'basic', feature: 'train' })
  })

  it('maps the remaining typed billing/plan error_types', () => {
    expect(errorFromResponse(402, { detail: { error_type: 'non_eligible_vpn_detected' } })).toBeInstanceOf(VpnDetectedError)
    expect(errorFromResponse(402, { detail: { error_type: 'not_enough_boost_credits' } })).toBeInstanceOf(NotEnoughBoostCreditsError)
    expect(errorFromResponse(402, { detail: { error_type: 'batch_rate_limit_reached', concurrent_batches_limit: 2 } })).toBeInstanceOf(BatchRateLimitError)
    expect(errorFromResponse(402, { detail: { error_type: 'auto_top_up_suspended' } })).toBeInstanceOf(AutoTopUpSuspendedError)
    expect(errorFromResponse(402, { detail: { error_type: 'grace_daily_limit_reached', data: { type: 'pay_less_notice' } } })).toBeInstanceOf(GraceDailyLimitError)
    expect(errorFromResponse(402, { detail: { error_type: 'workspace_member_spend_paused', workspace_id: 'w1', user_id: 'u1' } })).toBeInstanceOf(WorkspaceMemberSpendPausedError)
    expect(errorFromResponse(402, { detail: { error_type: 'account_blocked' } })).toBeInstanceOf(AccountSuspendedError)
  })

  it('maps media_too_large to a base ApiJobError keeping status 413 and maxSizeMb', () => {
    // fnf-api src/utils/media_size.py:16-22 — HTTP 413, detail { error_type, max_size_mb }.
    const err = errorFromResponse(413, { detail: { error_type: 'media_too_large', max_size_mb: 50 } })
    expect(err).toBeInstanceOf(ApiJobError)
    expect(err?.code).toBe('media_too_large')
    expect(err?.status).toBe(413)
    expect(err?.data).toEqual({ maxSizeMb: 50 })

    const round = errorFromJSON(JSON.parse(JSON.stringify(err!.toJSON())))
    expect(round.code).toBe('media_too_large')
    expect(round.status).toBe(413)
    expect(round.data).toEqual({ maxSizeMb: 50 })
  })

  it('maps request_timeout (content-check timeout) with the backend text as message', () => {
    // fnf-api src/handlers/media.py:282-290 — HTTP 408, detail { error_type, text }.
    const text = 'Content check is taking longer than expected. Please try again in a moment.'
    const err = errorFromResponse(408, { detail: { error_type: 'request_timeout', text } })
    expect(err).toBeInstanceOf(ApiJobError)
    expect(err?.code).toBe('request_timeout')
    expect(err?.status).toBe(408)
    expect(err?.message).toBe(text)

    const round = errorFromJSON(JSON.parse(JSON.stringify(err!.toJSON())))
    expect(round.code).toBe('request_timeout')
    expect(round.message).toBe(text)
  })

  it('maps unlim_battery_rate_limit_reached with billing context + concurrentBatchesLimit', () => {
    // fnf-api src/exceptions/auth.py:145-170 — HTTP 429, detail carries
    // workspace/plan_type/billing_period/concurrent_batches_limit.
    const err = errorFromResponse(429, {
      detail: { error_type: 'unlim_battery_rate_limit_reached', plan_type: 'Team', billing_period: 'monthly', workspace: { type: 'shared', role: 'member' }, concurrent_batches_limit: 4 },
    })
    expect(err).toBeInstanceOf(ApiJobError)
    expect(err?.code).toBe('unlim_battery_rate_limit_reached')
    expect(err?.status).toBe(429)
    expect(err?.data).toEqual({ plan: 'team', billingPeriod: 'monthly', team: { workspaceType: 'Shared', userRole: 'Member' }, concurrentBatchesLimit: 4 })

    const round = errorFromJSON(JSON.parse(JSON.stringify(err!.toJSON())))
    expect(round.code).toBe('unlim_battery_rate_limit_reached')
    expect(round.data).toEqual(err?.data)
  })

  it('maps enterprise_group_credit_limit_reached with text + camelCased limit fields', () => {
    // fnf-api src/exceptions/credit_limit.py:30-56 — HTTP 429,
    // detail { text, limit_amount, period, spent_in_period, cost }.
    const text = 'You\'ve reached your weekly workspace group credit limit. Ask your workspace admin to increase the group limit or wait until it resets.'
    const err = errorFromResponse(429, {
      detail: { error_type: 'enterprise_group_credit_limit_reached', text, limit_amount: 1000, period: 'every_week', spent_in_period: 990, cost: 20 },
    })
    expect(err).toBeInstanceOf(ApiJobError)
    expect(err?.code).toBe('enterprise_group_credit_limit_reached')
    expect(err?.status).toBe(429)
    expect(err?.message).toBe(text)
    expect(err?.data).toEqual({ limitAmount: 1000, period: 'every_week', spentInPeriod: 990, cost: 20 })

    const round = errorFromJSON(JSON.parse(JSON.stringify(err!.toJSON())))
    expect(round.code).toBe('enterprise_group_credit_limit_reached')
    expect(round.message).toBe(text)
    expect(round.data).toEqual(err?.data)
  })

  it('maps the bare 403 gate codes to base ApiJobErrors preserving the wire code', () => {
    // fnf-api src/exceptions/job.py:70-75 and :86-91 — HTTP 403, bare { error_type }.
    for (const code of ['free_generation_not_allowed', 'generation_not_available']) {
      const err = errorFromResponse(403, { detail: { error_type: code } })
      expect(err).toBeInstanceOf(ApiJobError)
      expect(err?.code).toBe(code)
      expect(err?.status).toBe(403)

      const round = errorFromJSON(JSON.parse(JSON.stringify(err!.toJSON())))
      expect(round.code).toBe(code)
      expect(round.status).toBe(403)
      expect(round.message).toBe(err?.message)
    }
  })

  it('matches KYB by detail.message', () => {
    expect(errorFromResponse(403, { detail: { message: 'KYB verification required' } })).toBeInstanceOf(KybVerificationRequiredError)
  })

  it('maps 409 workspace_selection_required, carrying workspaces in data', () => {
    const err = errorFromResponse(409, { detail: { error_type: 'workspace_selection_required', workspaces: [{ id: 'w1', name: null, type: 'private' }] } })
    expect(err).toBeInstanceOf(WorkspaceSelectionRequiredError)
    expect((err as WorkspaceSelectionRequiredError).data?.workspaces).toEqual([{ id: 'w1', name: null, type: 'private' }])
  })

  it('maps 409 job_in_progress (by error_type) to JobInProgressError', () => {
    const err = errorFromResponse(409, { detail: { error_type: 'job_in_progress' } })
    expect(err).toBeInstanceOf(JobInProgressError)
    expect(err?.status).toBe(409)
  })

  it('maps a bare 409 (no error_type) to UnknownSubmitResponseError, not JobInProgressError', () => {
    const err = errorFromResponse(409, { some: 'body' })
    expect(err).toBeInstanceOf(UnknownSubmitResponseError)
    expect(err?.status).toBe(409)
    expect((err as UnknownSubmitResponseError).data?.responseBody).toEqual({ some: 'body' })
  })

  it('maps 422 to ValidationError with the first detail message', () => {
    const err = errorFromResponse(422, { detail: [{ msg: 'prompt too long' }] })
    expect(err).toBeInstanceOf(ValidationError)
    expect(err?.message).toBe('prompt too long')
    expect(err?.status).toBe(422)
  })

  it('maps a string detail to ApiMessageError', () => {
    const err = errorFromResponse(400, { detail: 'something went wrong' })
    expect(err).toBeInstanceOf(ApiMessageError)
    expect(err?.message).toBe('something went wrong')
  })

  it('falls back to UnknownSubmitResponseError (code unknown) for unmapped failures', () => {
    const err = errorFromResponse(500, { detail: { weird: true } })
    expect(err).toBeInstanceOf(UnknownSubmitResponseError)
    expect(err?.code).toBe('unknown')
    expect(err?.status).toBe(500)
  })

  it('every produced error is a ApiJobError', () => {
    for (const type of ['not_enough_credits', 'rate_limit_reached', 'nsfw', 'non_eligible_vpn_detected', 'workspace_selection_required']) {
      expect(errorFromResponse(402, { detail: { error_type: type } })).toBeInstanceOf(ApiJobError)
    }
  })
})

describe('toJSON + errorFromJSON round-trip', () => {
  it('emits a uniform { code, message, status?, data? } shape', () => {
    // No pinned status — OutOfCreditsError carries whatever errorFromResponse
    // stamped (the backend emits 403; the class itself stays status-agnostic).
    const err = new OutOfCreditsError({ plan: 'pro', billingPeriod: 'monthly' })
    expect(err.toJSON()).toEqual({ code: 'out_of_credits', message: 'Not enough credits', data: { plan: 'pro', billingPeriod: 'monthly' } })
  })

  it('rehydrates the right class + data from JSON (survives a Comlink boundary)', () => {
    const cases = [
      new OutOfCreditsError({ plan: 'pro', team: { workspaceType: 'Shared', userRole: 'Member' } }),
      new RateLimitError({ plan: 'basic', maxCount: 5, isUnlimited: false }),
      new MinimumPlanError({ plan: 'plus', feature: 'avatar' }),
      new BatchRateLimitError(4),
      new AccountSuspendedError('account_blocked'),
      new VpnDetectedError(),
      new WorkspaceSelectionRequiredError([{ id: 'w1', name: 'Team', type: 'shared' }]),
    ]
    for (const original of cases) {
      const round = errorFromJSON(JSON.parse(JSON.stringify(original.toJSON())))
      expect(round).toBeInstanceOf(original.constructor as new (...a: any[]) => ApiJobError)
      expect(round.code).toBe(original.code)
      expect(round.data).toEqual(original.data)
    }
  })

  it('rehydrates ip_detected and ip_check_rate_limit_reached, preserving the message', () => {
    const ip = errorFromJSON(JSON.parse(JSON.stringify(new IpDetectedError('IP found in media').toJSON())))
    expect(ip).toBeInstanceOf(IpDetectedError)
    expect(ip.code).toBe('ip_detected')
    expect(ip.message).toBe('IP found in media')

    const limit = errorFromJSON(JSON.parse(JSON.stringify(new IpCheckRateLimitError().toJSON())))
    expect(limit).toBeInstanceOf(IpCheckRateLimitError)
    expect(limit.code).toBe('ip_check_rate_limit_reached')
    expect(limit.message).toMatch(/eligibility check limit/)
  })

  it('rehydrates code unknown to UnknownSubmitResponseError with status/body/url intact', () => {
    const original = new UnknownSubmitResponseError(500, { weird: true }, 'https://api/jobs/demo')
    const round = errorFromJSON(JSON.parse(JSON.stringify(original.toJSON())))
    expect(UnknownSubmitResponseError.is(round)).toBe(true) // .is() works again after the round-trip
    expect(round.status).toBe(500)
    expect((round as UnknownSubmitResponseError).data?.responseBody).toEqual({ weird: true })
    expect((round as UnknownSubmitResponseError).data?.responseUrl).toBe('https://api/jobs/demo')
  })

  it('rehydrates an unknown code to a generic ApiJobError', () => {
    const round = errorFromJSON({ code: 'some_future_code', message: 'hi', data: { x: 1 } })
    expect(round).toBeInstanceOf(ApiJobError)
    expect(round.code).toBe('some_future_code')
    expect(round.data).toEqual({ x: 1 })
  })

  it('rehydrates the client-lifecycle codes, preserving the timeout message and generation', () => {
    const aborted = errorFromJSON(new JobAbortedError().toJSON())
    expect(aborted).toBeInstanceOf(JobAbortedError)

    const gen = { id: 'j1', model: 'demo', type: 'image', status: 'in_progress', input: { model: 'demo', settings: {} } } as const
    const original = new JobTimeoutError('j1', 60_000, gen as never)
    const round = errorFromJSON(JSON.parse(JSON.stringify(original.toJSON())))
    expect(round).toBeInstanceOf(JobTimeoutError)
    expect(round.message).toBe(original.message) // not rebuilt as "within 0ms"
    expect((round as JobTimeoutError).data?.generation?.id).toBe('j1')
  })

  it('rehydrates media-pipeline errors to their classes (registered from the media half)', () => {
    const moderation = errorFromJSON(JSON.parse(JSON.stringify(new MediaModerationError('nsfw').toJSON())))
    expect(moderation).toBeInstanceOf(MediaModerationError)
    expect(moderation.code).toBe('media_moderation_blocked')
    expect((moderation as MediaModerationError).data?.status).toBe('nsfw')

    const transfer = errorFromJSON(new UploadTransferError('Upload failed (503)', 503).toJSON())
    expect(transfer).toBeInstanceOf(UploadTransferError)
    expect(transfer.status).toBe(503)
  })

  it('does not crash on a data-less payload for any registered code', () => {
    // A different SDK version (or hand-built payload) may legitimately omit data.
    for (const code of ['minimum_plan_required', 'out_of_credits', 'rate_limit', 'workspace_subscription_inactive']) {
      expect(() => errorFromJSON({ code, message: 'x' })).not.toThrow()
    }
  })

  it('preserves the serialized status when the factory drops it', () => {
    const round = errorFromJSON({ code: 'rate_limit', message: 'x', status: 429 })
    expect(round.status).toBe(429)
  })
})

describe('errorFromResponse stamps the HTTP status', () => {
  it('mapped errors without a hard-coded status carry the response status', () => {
    const err = errorFromResponse(429, { detail: { error_type: 'rate_limit_reached' } })
    expect(err?.code).toBe('rate_limit')
    expect(err?.status).toBe(429)

    const auth = errorFromResponse(401, { detail: 'Not authenticated' })
    expect(auth?.code).toBe('api_message')
    expect(auth?.status).toBe(401)
  })

  it('keeps the deliberately hard-coded statuses', () => {
    const err = errorFromResponse(400, { detail: { error_type: 'job_in_progress' } })
    expect(err?.status).toBe(409) // JobInProgressError pins 409
  })

  it('stamps the real status on out_of_credits instead of a pinned 402', () => {
    // Backend emits 403 at both not_enough_credits sites (fnf-api
    // src/exceptions/auth.py:71-88, src/exceptions/workspace.py:267-290).
    const err = errorFromResponse(403, { detail: { error_type: 'not_enough_credits' } })
    expect(err?.status).toBe(403)
  })
})

describe('.is() type-guard sugar', () => {
  const oc = new OutOfCreditsError({ plan: 'pro' })

  it('narrows by leaf, mid-tier, and base', () => {
    expect(OutOfCreditsError.is(oc)).toBe(true)
    expect(RateLimitError.is(oc)).toBe(false)
    expect(BillingError.is(oc)).toBe(true) // mid-tier groups all billing errors
    expect(ApiJobError.is(oc)).toBe(true)
  })

  it('returns false for non-errors and plain JSON', () => {
    expect(OutOfCreditsError.is(new Error('x'))).toBe(false)
    expect(OutOfCreditsError.is(oc.toJSON())).toBe(false) // serialized form is not an instance
    expect(ApiJobError.is(undefined)).toBe(false)
  })
})
