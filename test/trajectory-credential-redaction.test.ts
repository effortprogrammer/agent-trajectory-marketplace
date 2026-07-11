import { describe, expect, test } from "bun:test"

import {
  containsCredentialInValue,
  containsCredentialPattern,
  redactCredentialSpans,
} from "../src/trajectory/credential-redaction"

describe("credential-pattern redaction (payload lane)", () => {
  test("redacts real credential shapes but preserves innocuous word mentions", () => {
    // Real secrets → redacted.
    for (const secret of [
      "Authorization: Bearer abcdef0123456789abcdef",
      "api_key=sk-proj-Abc123Def456Ghi789Jkl012Mno345",
      "sk-Abcdefghijklmnopqrstuvwxyz0123",
      "ghp_Abcdefghijklmnopqrstuvwxyz0123456789",
      "xoxb-1234567890-abcdefghij",
      "AKIAIOSFODNN7EXAMPLE",
      "AIzaSyAbcdefghijklmnopqrstuvwxyz012345",
    ]) {
      expect(containsCredentialPattern(secret)).toBe(true)
      expect(redactCredentialSpans(secret)).toContain("[redacted]")
    }

    // Innocuous mentions of secret-adjacent words survive — this is the whole
    // point vs the blunt detail-lane scan.
    for (const clean of [
      "the token count was 42",
      "reset your password in settings",
      "this is the secret sauce",
      "authorization required before merge",
      "tokens: 1200 input, 45 output",
    ]) {
      expect(containsCredentialPattern(clean)).toBe(false)
      expect(redactCredentialSpans(clean)).toBe(clean)
    }
  })

  test("redacts PEM private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----"
    expect(containsCredentialPattern(pem)).toBe(true)
    expect(redactCredentialSpans(pem)).toBe("[redacted]")
  })

  test("walks nested payload values for credential leaves", () => {
    expect(
      containsCredentialInValue({
        output: "clean tool output\nline two",
        nested: [{ text: "token count 5" }],
      }),
    ).toBe(false)
    expect(
      containsCredentialInValue({
        output: "curl -H 'Authorization: Bearer abcdef0123456789abcdef' https://x",
      }),
    ).toBe(true)
    expect(containsCredentialInValue(["a", ["b", "sk-Abcdefghijklmnopqrstuvwxyz0123"]])).toBe(true)
  })
})
