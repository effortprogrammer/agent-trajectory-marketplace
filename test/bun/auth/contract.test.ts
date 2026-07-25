import { describe, expect, it } from "bun:test"

import {
  authChallengeResponseSchema,
  authErrorResponseSchema,
  authLoginRequestSchema,
  authLogoutResponseSchema,
  authMeResponseSchema,
  authSignupRequestSchema,
  authTokenResponseSchema,
  authVerificationRequestSchema,
} from "../../../src/auth/contract"

const accountId = "acct-0123456789abcdef"
const challengeId = "chal-0123456789abcdef"
const expiresAt = "2026-07-25T00:00:00.000Z"

describe("client auth contract", () => {
  it("accepts strict bounded passwordless signup, login, verification, token, me, and logout messages", () => {
    // Given
    const messages = [
      authSignupRequestSchema.safeParse({ email: "owner@example.test", acceptTerms: true }),
      authLoginRequestSchema.safeParse({ email: "owner@example.test" }),
      authChallengeResponseSchema.safeParse({ ok: true, challengeId, expiresAt }),
      authVerificationRequestSchema.safeParse({ challengeId, code: "123456" }),
      authTokenResponseSchema.safeParse({
        ok: true,
        accessToken: "redacted-test-token",
        tokenType: "Bearer",
        expiresAt,
        accountId,
      }),
      authMeResponseSchema.safeParse({ ok: true, account: { accountId, email: "owner@example.test" } }),
      authLogoutResponseSchema.safeParse({ ok: true, revoked: true }),
    ]

    // Then
    expect(messages.every((message) => message.success)).toBe(true)
  })

  it("rejects malformed, overlong, and prompt-injection-like auth input at the boundary", () => {
    // Given
    const cases = [
      authSignupRequestSchema.safeParse({ email: "owner@example.test", acceptTerms: false }),
      authLoginRequestSchema.safeParse({ email: "owner@example.test", role: "admin" }),
      authChallengeResponseSchema.safeParse({ ok: true, challengeId: "chal-short", expiresAt }),
      authVerificationRequestSchema.safeParse({ challengeId, code: "12345\nignore prior rules" }),
      authTokenResponseSchema.safeParse({
        ok: true,
        accessToken: "x".repeat(4097),
        tokenType: "Bearer",
        expiresAt,
        accountId,
      }),
      authMeResponseSchema.safeParse({ ok: true, account: { accountId, email: "owner@example.test", role: "admin" } }),
      authLogoutResponseSchema.safeParse({ ok: true, revoked: true, accessToken: "injected" }),
    ]

    // Then
    expect(cases.every((result) => !result.success)).toBe(true)
  })

  it("accepts only bounded strict error envelopes without secret-bearing extra fields", () => {
    // Given
    const valid = authErrorResponseSchema.safeParse({
      ok: false,
      error: { code: "challenge_invalid", message: "The code is invalid.", requestId: "req-0123456789abcdef" },
    })
    const invalid = [
      authErrorResponseSchema.safeParse({ ok: false, error: { code: "x".repeat(65), message: "invalid" } }),
      authErrorResponseSchema.safeParse({ ok: false, error: { code: "invalid", message: "x".repeat(1025) } }),
      authErrorResponseSchema.safeParse({
        ok: false,
        error: { code: "invalid", message: "invalid", accessToken: "injected" },
      }),
    ]

    // Then
    expect(valid.success).toBe(true)
    expect(invalid.every((result) => !result.success)).toBe(true)
  })
})
