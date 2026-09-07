import { PublishClientError } from "./publish-client"
import { StatusClientError } from "./status-client"

export const candidateRemoteErrorCodes = [
  "weekly_upload_limit",
  "rate_limited",
  "invalid_candidate",
  "unauthorized",
  "not_found",
  "payload_too_large",
  "service_unavailable",
] as const

export type CandidateRemoteErrorCode = typeof candidateRemoteErrorCodes[number]

const candidateRemoteErrorMessages: Readonly<Record<CandidateRemoteErrorCode, string>> = {
  weekly_upload_limit: "Weekly upload limit reached. Please try again later.",
  rate_limited: "Request limit reached. Please try again later.",
  invalid_candidate: "Upload request is invalid. Check the bundle.",
  unauthorized: "Authentication failed. Check your credentials.",
  not_found: "Submission not found.",
  payload_too_large: "Upload is too large.",
  service_unavailable: "Service unavailable. Please try again later.",
}

export class CandidateRemoteCliError extends Error {
  readonly name = "CandidateRemoteCliError"

  constructor(readonly code: CandidateRemoteErrorCode, message = candidateRemoteErrorMessages[code]) {
    super(message)
  }
}

const customerCodeFor = (code: string): CandidateRemoteErrorCode | undefined => {
  switch (code) {
    case "weekly_upload_limit":
    case "rate_limited":
    case "invalid_candidate":
    case "unauthorized":
    case "not_found":
    case "payload_too_large":
      return code
    case "idempotency_conflict":
      return "invalid_candidate"
    case "unavailable":
      return "service_unavailable"
    default:
      return undefined
  }
}

export const presentCandidateRemoteError = (error: unknown): CandidateRemoteCliError | undefined => {
  if (error instanceof PublishClientError && error.status === 0) return undefined
  if (!(error instanceof PublishClientError) && !(error instanceof StatusClientError)) return undefined
  const code = customerCodeFor(error.code)
  return code === undefined ? undefined : new CandidateRemoteCliError(
    code,
    error.code === "idempotency_conflict"
      ? "Upload request conflicts with an earlier request."
      : undefined,
  )
}
