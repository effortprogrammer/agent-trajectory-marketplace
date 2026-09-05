import { createHash } from "node:crypto"

import type { PublishBundle } from "./publish-bundle"

const policyText = "I confirm that I have the rights and permissions needed to submit the selected session data. I authorize ATM to store, process, redact, and package this data and to license it to customers for commercial model training and evaluation. This permission applies only to the uploaded bundle identified by its SHA-256. It does not authorize public examples, marketing excerpts, or public disclosure of session content."

export const uploadConsentPolicy = Object.freeze({
  policyVersion: "session-commercial-use-v1",
  policySha256: createHash("sha256").update(policyText, "utf8").digest("hex"),
  text: policyText,
})

export const uploadConsentPolicyJson = Buffer.from(JSON.stringify(uploadConsentPolicy), "utf8")

export class CommercialUseConsent {
  declare private readonly commercialUseConsent: void

  readonly sha256: string
  readonly #archiveSha256: string
  readonly #bytes: Buffer
  readonly #manifestSha256: string

  private constructor(bundle: PublishBundle) {
    this.#archiveSha256 = bundle.candidate.archiveSha256
    this.#manifestSha256 = bundle.candidate.manifestSha256
    this.#bytes = Buffer.from(JSON.stringify({
      policyVersion: uploadConsentPolicy.policyVersion,
      policySha256: uploadConsentPolicy.policySha256,
      archiveSha256: this.#archiveSha256,
      manifestSha256: this.#manifestSha256,
      commercialUse: true,
      rightsConfirmed: true,
      publicExamples: false,
    }), "utf8")
    this.sha256 = createHash("sha256").update(this.#bytes).digest("hex")
  }

  static affirm(bundle: PublishBundle): CommercialUseConsent {
    return new CommercialUseConsent(bundle)
  }

  headerValue(): string {
    return this.#bytes.toString("base64url")
  }

  matches(bundle: PublishBundle): boolean {
    return this.#archiveSha256 === bundle.candidate.archiveSha256
      && this.#manifestSha256 === bundle.candidate.manifestSha256
  }
}

export const affirmCommercialUse = (bundle: PublishBundle): CommercialUseConsent =>
  CommercialUseConsent.affirm(bundle)
