import { describe, expect, test } from "bun:test"

import {
  ResidualSecretScanError,
  assertNoResidualSecrets,
} from "../../../src/marketplace/residual-secret-scan"

const encoder = new TextEncoder()

const atfBytes = (content: string): Uint8Array => encoder.encode(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{ kind: "message", name: "assistant", payload: { content } }],
}))

describe("post-redaction residual secret scan", () => {
  test("rejects known provider credential formats without changing the supplied bytes", () => {
    // Given: a residual GitHub fine-grained token in otherwise already-sanitized ATF bytes.
    const bytes = atfBytes(`github_pat_${"a".repeat(82)}`)
    const before = new Uint8Array(bytes)

    // When: the local scan runs.
    const scan = (): void => {
      assertNoResidualSecrets(bytes)
    }

    // Then: it fails closed and never rewrites the caller's bytes.
    expect(scan).toThrow(ResidualSecretScanError)
    expect(bytes).toEqual(before)
  })

  test("rejects credentials encoded with JSON escapes without changing the supplied bytes", () => {
    // Given: JSON-valid ATF bytes whose payload decodes to a GitHub fine-grained token.
    const bytes = encoder.encode(`{"runtime":"codex","status":"collected","formatVersion":2,"eventCount":1,"events":[{"kind":"message","name":"assistant","payload":{"content":"github_pat_\\u0061${"a".repeat(81)}"}}]}`)
    const before = new Uint8Array(bytes)

    // When: the scanner inspects the parsed semantic content.
    const scan = (): void => {
      assertNoResidualSecrets(bytes)
    }

    // Then: JSON serialization cannot conceal a residual credential.
    expect(scan).toThrow(ResidualSecretScanError)
    expect(bytes).toEqual(before)
  })

  test("rejects decoded JSON property names containing residual credentials", () => {
    // Given: semantic JSON whose structural key itself carries a credential.
    const bytes = encoder.encode(`{"github_pat_${"a".repeat(82)}":"redacted"}`)

    // When / Then: keys cannot smuggle credentials around decoded-value scanning.
    expect(() => assertNoResidualSecrets(bytes)).toThrow(ResidualSecretScanError)
  })

  test("allows credential-adjacent instructional text", () => {
    // Given: prose that names a credential environment variable but carries no credential value.
    const bytes = atfBytes("Set GITHUB_TOKEN in your environment; never paste a token value.")

    // When / Then: documentation remains valid scan input.
    expect(() => assertNoResidualSecrets(bytes)).not.toThrow()
  })

  test("fails closed before decoding malformed or unbounded input", () => {
    // Given: invalid UTF-8 and an input that exceeds the trace scan budget.
    const malformed = encoder.encode("{")
    const invalidUtf8 = new Uint8Array([0xff])
    const unbounded = new Proxy({ byteLength: 64 * 1024 * 1024 + 1 }, {
      get(target, property) {
        if (property === "byteLength") return target.byteLength
        throw new Error(`unexpected input access: ${String(property)}`)
      },
    }) as unknown as Uint8Array

    // When: the scanner receives unsafe boundary input.
    const malformedScan = (): void => {
      assertNoResidualSecrets(malformed)
    }
    const invalidUtf8Scan = (): void => {
      assertNoResidualSecrets(invalidUtf8)
    }
    const unboundedScan = (): void => {
      assertNoResidualSecrets(unbounded)
    }

    // Then: all reject without attempting permissive decoding or unbounded traversal.
    expect(malformedScan).toThrow(ResidualSecretScanError)
    expect(invalidUtf8Scan).toThrow(ResidualSecretScanError)
    expect(unboundedScan).toThrow(ResidualSecretScanError)
  })
})
