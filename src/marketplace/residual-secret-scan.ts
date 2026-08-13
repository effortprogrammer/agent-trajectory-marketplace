import { datasetArchivePolicy } from "./archive-contract"
import { parseAdmissionJson } from "./json-preflight"

const maxScannedTraceBytes = datasetArchivePolicy.maxTraceBytes

const residualCredentialPatterns = [
  /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
] as const

export class ResidualSecretScanError extends Error {
  public constructor() {
    super("residual_secret")
    this.name = "ResidualSecretScanError"
  }
}

export const assertNoResidualSecrets = (bytes: Uint8Array): void => {
  if (bytes.byteLength === 0 || bytes.byteLength > maxScannedTraceBytes) {
    throw new ResidualSecretScanError()
  }

  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (parseAdmissionJson(data) === undefined) throw new ResidualSecretScanError()
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)

  if (residualCredentialPatterns.some((pattern) => pattern.test(text))) {
    throw new ResidualSecretScanError()
  }
}
