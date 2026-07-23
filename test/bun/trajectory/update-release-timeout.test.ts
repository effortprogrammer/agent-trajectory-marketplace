import { expect, jest, test } from "bun:test"
import {
  type ReleaseTransport,
  verifyAvailableRelease,
} from "../../../src/trajectory/update-release-verifier"

test("times out a hung transport request", async () => {
  // Given
  jest.useFakeTimers()
  const transport: ReleaseTransport = {
    request: () => new Promise(() => undefined),
  }

  // When
  const verification = verifyAvailableRelease({
    currentVersion: "1.2.2",
    targetTag: "v1.2.3",
    transport,
  })
  jest.advanceTimersByTime(15_000)

  // Then
  try {
    await expect(verification).rejects.toEqual(expect.objectContaining({ code: "invalid-release" }))
  } finally {
    jest.useRealTimers()
  }
})

