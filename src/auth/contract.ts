import { z } from "zod"

export const authContractPolicy = {
  maxAccessTokenCharacters: 4096,
  maxErrorCodeCharacters: 64,
  maxErrorMessageCharacters: 1024,
  maxRequestIdCharacters: 128,
} as const

export const authAccountIdSchema = z.string().regex(/^acct-[a-f0-9]{16}$/).brand<"AuthAccountId">()
export const authChallengeIdSchema = z.string().regex(/^chal-[a-f0-9]{16}$/).brand<"AuthChallengeId">()
export const authEmailSchema = z.string().trim().toLowerCase().email().max(320).brand<"AuthEmail">()
export const authOtpCodeSchema = z.string().regex(/^\d{6}$/).brand<"AuthOtpCode">()
export const authAccessTokenSchema = z
  .string()
  .min(1)
  .max(authContractPolicy.maxAccessTokenCharacters)
  .brand<"AuthAccessToken">()
export const authExpirySchema = z.string().datetime({ offset: true }).max(64).brand<"AuthExpiry">()

export const authSignupRequestSchema = z
  .object({
    email: authEmailSchema,
    acceptTerms: z.literal(true),
  })
  .strict()

export const authLoginRequestSchema = z
  .object({
    email: authEmailSchema,
  })
  .strict()

export const authChallengeResponseSchema = z
  .object({
    ok: z.literal(true),
    challengeId: authChallengeIdSchema,
    expiresAt: authExpirySchema,
  })
  .strict()

export const authVerificationRequestSchema = z
  .object({
    challengeId: authChallengeIdSchema,
    code: authOtpCodeSchema,
  })
  .strict()

export const authTokenResponseSchema = z
  .object({
    ok: z.literal(true),
    accessToken: authAccessTokenSchema,
    tokenType: z.literal("Bearer"),
    expiresAt: authExpirySchema,
    accountId: authAccountIdSchema,
  })
  .strict()

export const authAccountSchema = z
  .object({
    accountId: authAccountIdSchema,
    email: authEmailSchema,
  })
  .strict()

export const authMeResponseSchema = z
  .object({
    ok: z.literal(true),
    account: authAccountSchema,
  })
  .strict()

export const authLogoutResponseSchema = z
  .object({
    ok: z.literal(true),
    revoked: z.boolean(),
  })
  .strict()

export const authErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9_]*$/).max(authContractPolicy.maxErrorCodeCharacters),
        message: z.string().min(1).max(authContractPolicy.maxErrorMessageCharacters),
        requestId: z.string().regex(/^req-[a-zA-Z0-9_-]+$/).max(authContractPolicy.maxRequestIdCharacters).optional(),
      })
      .strict(),
  })
  .strict()

export type AuthAccountId = z.infer<typeof authAccountIdSchema>
export type AuthChallengeId = z.infer<typeof authChallengeIdSchema>
export type AuthEmail = z.infer<typeof authEmailSchema>
export type AuthOtpCode = z.infer<typeof authOtpCodeSchema>
export type AuthAccessToken = z.infer<typeof authAccessTokenSchema>
export type AuthExpiry = z.infer<typeof authExpirySchema>
export type AuthSignupRequest = Readonly<{ email: AuthEmail; acceptTerms: true }>
export type AuthLoginRequest = Readonly<{ email: AuthEmail }>
export type AuthChallengeResponse = Readonly<{ ok: true; challengeId: AuthChallengeId; expiresAt: AuthExpiry }>
export type AuthVerificationRequest = Readonly<{ challengeId: AuthChallengeId; code: AuthOtpCode }>
export type AuthTokenResponse = Readonly<{
  ok: true
  accessToken: AuthAccessToken
  tokenType: "Bearer"
  expiresAt: AuthExpiry
  accountId: AuthAccountId
}>
export type AuthAccount = Readonly<{ accountId: AuthAccountId; email: AuthEmail }>
export type AuthMeResponse = Readonly<{ ok: true; account: AuthAccount }>
export type AuthLogoutResponse = Readonly<{ ok: true; revoked: boolean }>
export type AuthErrorResponse = Readonly<{
  ok: false
  error: Readonly<{ code: string; message: string; requestId?: string }>
}>
