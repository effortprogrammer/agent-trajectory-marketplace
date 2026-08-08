import { describe, expect, test } from "bun:test"

import { boundedRedactedString } from "../../../src/trajectory/adapters/payload-redaction"

const redact = (value: string): string => boundedRedactedString(value, 16 * 1024).text

describe("credential span redaction", () => {
  test.each([
    "AWS_SECRET_ACCESS_KEY=TestOnlySecretValue0000000000/EXAMPLEVALUE",
    "AWS_SESSION_TOKEN=TestOnlySessionTokenValue0000000000",
    "GITHUB_PERSONAL_ACCESS_TOKEN=TestOnlyGithubTokenValue0000",
    "MY_CUSTOM_API_KEY=TestOnlyCustomKeyValue",
    "STRIPE_SECRET_KEY=TestOnlyStripeSecretValue0000",
  ] as const)("redacts environment-style assignment %s", (value) => {
    // Given: an environment-style credential assignment with underscore segments.
    // When: the value crosses the redaction boundary.
    // Then: the secret span cannot survive.
    expect(redact(value)).not.toContain(value.split("=")[1])
    expect(redact(value)).toContain("[redacted]")
  })

  test.each([
    "monkey=banana",
    "KEYBOARD_LAYOUT=us",
    "XDG_CONFIG_HOME=/tmp/config",
    "donkey=kong",
  ] as const)("preserves benign assignment %s", (value) => {
    // Given: an assignment whose key has no sensitive segment.
    // When: the value crosses the redaction boundary.
    // Then: non-credential content survives unchanged.
    expect(redact(value)).toBe(value)
  })
})
