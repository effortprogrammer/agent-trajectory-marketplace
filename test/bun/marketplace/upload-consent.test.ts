import { createHash } from "node:crypto"

import { afterEach, expect, test } from "bun:test"

import { createPublishClient, PublishClientError } from "../../../src/marketplace/publish-client"
import { compensatedPublishBundle } from "../fixtures/compensated-publish-bundle"
import {
  affirmCommercialUse,
  uploadConsentPolicy,
  uploadConsentPolicyJson,
} from "../../../src/marketplace/upload-consent"

const servers: Bun.Server<undefined>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

const expectClientError = async (action: () => Promise<unknown>): Promise<PublishClientError> => {
  try {
    await action()
  } catch (error) {
    if (error instanceof PublishClientError) return error
    throw error
  }
  throw new TypeError("expected PublishClientError")
}

test("ships the exact current commercial-use policy and canonical policy response", () => {
  const text = "I confirm that I have the rights and permissions needed to submit the selected session data. I authorize ATM to store, process, redact, and package this data and to license it to customers for commercial model training and evaluation. This permission applies only to the uploaded bundle identified by its SHA-256. It does not authorize public examples, marketing excerpts, or public disclosure of session content."
  const policySha256 = createHash("sha256").update(text, "utf8").digest("hex")

  expect(uploadConsentPolicy).toEqual({
    policyVersion: "session-commercial-use-v1",
    policySha256,
    text,
  })
  expect(uploadConsentPolicyJson).toEqual(Buffer.from(JSON.stringify(uploadConsentPolicy), "utf8"))
})

test("checks the current policy before posting the exact hash-bound consent header", async () => {
  const bundle = compensatedPublishBundle()
  const consent = affirmCommercialUse(bundle)
  const requests: Readonly<{ readonly method: string; readonly path: string }>[] = []
  const submissionId = `sub_${"0".repeat(26)}`
  let receivedHeader = ""
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url)
      requests.push({ method: request.method, path: url.pathname })
      if (request.method === "GET") return new Response(uploadConsentPolicyJson, { status: 200 })
      receivedHeader = request.headers.get("x-atm-upload-consent") ?? ""
      await request.arrayBuffer()
      return Response.json({
        protocolVersion: 1,
        submissionId,
        status: "accepted",
        statusUrl: `/v1/marketplace/seller/candidates/${submissionId}`,
      }, { headers: { "x-atm-upload-consent-sha256": consent.sha256 }, status: 202 })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  servers.push(server)

  await createPublishClient(`http://127.0.0.1:${server.port}`).publish({
    bundle,
    consent,
    credential: "test-key",
  })

  expect(requests).toEqual([
    { method: "GET", path: "/v1/marketplace/seller/upload-consent-policy" },
    { method: "POST", path: "/v1/marketplace/seller/candidates" },
  ])
  expect(Buffer.from(receivedHeader, "base64url")).toEqual(Buffer.from(JSON.stringify({
    policyVersion: uploadConsentPolicy.policyVersion,
    policySha256: uploadConsentPolicy.policySha256,
    archiveSha256: bundle.candidate.archiveSha256,
    manifestSha256: bundle.candidate.manifestSha256,
    commercialUse: true,
    rightsConfirmed: true,
    publicExamples: false,
  }), "utf8"))
})

test("fails closed when the policy endpoint is absent or the receipt lacks the consent digest", async () => {
  const bundle = compensatedPublishBundle()
  const consent = affirmCommercialUse(bundle)
  let posts = 0
  const missingPolicy = Bun.serve({
    fetch: (request) => {
      if (request.method === "POST") posts += 1
      return Response.json({ protocolVersion: 1, code: "not_found" }, { status: 404 })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  servers.push(missingPolicy)
  const policyError = await expectClientError(() => createPublishClient(`http://127.0.0.1:${missingPolicy.port}`).publish({
    bundle,
    consent,
    credential: "test-key",
  }))

  let mismatchPosts = 0
  const mismatchedPolicy = Bun.serve({
    fetch: (request) => {
      if (request.method === "POST") mismatchPosts += 1
      return new Response(Buffer.from(JSON.stringify({ ...uploadConsentPolicy, text: "changed" }), "utf8"), { status: 200 })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  servers.push(mismatchedPolicy)
  const mismatchError = await expectClientError(() => createPublishClient(`http://127.0.0.1:${mismatchedPolicy.port}`).publish({
    bundle,
    consent,
    credential: "test-key",
  }))

  const submissionId = `sub_${"0".repeat(26)}`
  const missingReceiptHash = Bun.serve({
    fetch: (request) => request.method === "GET"
      ? new Response(uploadConsentPolicyJson, { status: 200 })
      : Response.json({ protocolVersion: 1, submissionId, status: "accepted", statusUrl: `/v1/marketplace/seller/candidates/${submissionId}` }, { status: 202 }),
    hostname: "127.0.0.1",
    port: 0,
  })
  servers.push(missingReceiptHash)
  const receiptBundle = compensatedPublishBundle()
  const receiptError = await expectClientError(() => createPublishClient(`http://127.0.0.1:${missingReceiptHash.port}`).publish({
    bundle: receiptBundle,
    consent: affirmCommercialUse(receiptBundle),
    credential: "test-key",
  }))

  expect({ policyError: policyError.code, posts, mismatchError: mismatchError.code, mismatchPosts, receiptError: receiptError.code }).toEqual({
    policyError: "invalid_upload_consent_policy",
    posts: 0,
    mismatchError: "invalid_upload_consent_policy",
    mismatchPosts: 0,
    receiptError: "invalid_upload_consent",
  })
})
