import { datasetArchivePolicy } from "./archive-contract"
import { MarketplaceError } from "./error"

const maximumProjectionBytes = datasetArchivePolicy.maxTraceBytes

const invalidProjection = (): never => {
  throw new MarketplaceError("invalid_bundle_request")
}

export const normalizedSanitizedTraceProjection = (sanitizedBytes: Uint8Array): string => {
  if (sanitizedBytes.byteLength <= 0 || sanitizedBytes.byteLength > maximumProjectionBytes) {
    return invalidProjection()
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(sanitizedBytes)
  } catch (error) {
    if (error instanceof TypeError) return invalidProjection()
    throw error
  }
  return text.normalize("NFC").toLowerCase()
}
