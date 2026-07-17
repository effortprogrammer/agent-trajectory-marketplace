import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import {
  normalizeAtfObservations,
  TrajectoryObservationError,
  TrajectoryObservationErrorCode,
  trajectoryObservationPolicy,
  trajectoryObservationSchema,
  trajectoryObservationSetSchema,
} from "../src/trajectory/observation"

const archiveSha256 = "a".repeat(64)

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex")

const artifact = (artifactPath: string, document: unknown) => {
  const sourceBytes = Buffer.from(JSON.stringify(document), "utf8")
  return {
    artifactPath,
    artifactSha256: sha256(sourceBytes),
    sourceBytes,
  }
}

const captureError = (action: () => unknown): TrajectoryObservationError => {
  try {
    action()
  } catch (error) {
    if (error instanceof TrajectoryObservationError) {
      return error
    }
    throw error
  }
  throw new TypeError("expected TrajectoryObservationError")
}

const normalizedSchemaFixture = () =>
  normalizeAtfObservations({
    archiveSha256,
    artifacts: [
      artifact("traces/schema.atf.json", {
        runtime: "r",
        status: "instrumented",
        eventCount: 1,
        events: [{ kind: "session_start", name: "session", detail: "private" }],
      }),
    ],
  })

const normalizedRelationalIdentityFixture = () =>
  normalizeAtfObservations({
    archiveSha256,
    artifacts: [
      artifact("traces/relational-identity.atf.json", {
        runtime: "r",
        status: "instrumented",
        eventCount: 2,
        events: [
          { kind: "session_start", name: "session", detail: "private-a" },
          { kind: "llm_call", name: "model", detail: "private-b" },
        ],
      }),
    ],
  })

const normalizedRelationalToolFixture = () =>
  normalizeAtfObservations({
    archiveSha256,
    artifacts: [
      artifact("traces/relational-tools.atf.json", {
        runtime: "r",
        status: "collected",
        formatVersion: 2,
        eventCount: 4,
        events: [
          {
            kind: "tool_call",
            name: "Read",
            detail: "private-a",
            payload: { toolUseId: "link-a", input: {} },
          },
          {
            kind: "tool_result",
            name: "Read",
            detail: "private-b",
            payload: { toolUseId: "link-a", output: "private-c" },
          },
          {
            kind: "tool_call",
            name: "Write",
            detail: "private-d",
            payload: { toolUseId: "link-b", input: {} },
          },
          {
            kind: "tool_result",
            name: "Write",
            detail: "private-e",
            payload: { toolUseId: "link-b", output: "private-f" },
          },
        ],
      }),
    ],
  })

const expectObservationSetIssue = (input: unknown, message: string): void => {
  const result = trajectoryObservationSetSchema.safeParse(input)
  if (result.success) throw new TypeError(`expected observation-set issue: ${message}`)
  expect(result.error.issues.map((issue) => issue.message)).toContain(message)
}

describe("canonical ATF observations", () => {
  test("normalizes v2 tool call and result", () => {
    // Given: a v2 trace whose source lanes contain adversarial private text.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/tool.atf.json", {
          runtime: "PRIVATE_RUNTIME_SENTINEL",
          status: "collected",
          formatVersion: 2,
          eventCount: 2,
          events: [
            {
              kind: "tool_call",
              name: "PRIVATE_TOOL_NAME_SENTINEL",
              detail: "PRIVATE_DETAIL_SENTINEL",
              payload: {
                toolUseId: "private-link-id",
                input: { command: "PRIVATE_INPUT_SENTINEL" },
              },
            },
            {
              kind: "tool_result",
              name: "PRIVATE_TOOL_NAME_SENTINEL",
              detail: "ok",
              payload: {
                toolUseId: "private-link-id",
                isError: false,
                output: "PRIVATE_OUTPUT_SENTINEL",
              },
            },
          ],
        }),
      ],
    }

    // When: canonical bytes are parsed and normalized.
    const normalized = normalizeAtfObservations(input)

    // Then: structural facts and linkage survive, while source content does not.
    expect(normalized.summary).toEqual({
      artifactCount: 1,
      observationCount: 2,
      atfVersionCounts: { v1: 0, v2: 1 },
    })
    const toolCall = normalized.observations[0]
    const toolResult = normalized.observations[1]
    if (toolCall === undefined || toolResult === undefined) {
      throw new TypeError("expected two normalized observations")
    }
    expect(toolCall).toMatchObject({ ordinal: 0, eventClass: "tool_call" })
    expect(toolResult).toMatchObject({
      ordinal: 1,
      eventClass: "tool_result",
      error: { availability: "available", outcome: "success" },
    })
    expect(Object.isFrozen(toolCall.source)).toBe(true)
    expect(Object.keys(toolCall.source)).toEqual([
      "archiveSha256",
      "artifactPath",
      "artifactSha256",
      "eventIndex",
    ])
    expect(toolCall?.toolUseLink).toEqual({
      status: "matched",
      counterpartObservationId: toolResult?.id,
    })
    expect(toolResult?.toolUseLink).toEqual({
      status: "matched",
      counterpartObservationId: toolCall?.id,
    })

    const serialized = JSON.stringify(normalized)
    for (const forbidden of [
      "PRIVATE_RUNTIME_SENTINEL",
      "PRIVATE_TOOL_NAME_SENTINEL",
      "PRIVATE_DETAIL_SENTINEL",
      "PRIVATE_INPUT_SENTINEL",
      "PRIVATE_OUTPUT_SENTINEL",
      "private-link-id",
      '"detail"',
      '"payload"',
      '"toolUseId"',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("derives stable ids and manifest-order ordinals from source identity", () => {
    // Given: two artifacts in an explicit manifest order.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/b.atf.json", {
          runtime: "r",
          status: "instrumented",
          eventCount: 2,
          events: [
            { kind: "session_start", name: "private-session", detail: "private-a" },
            { kind: "llm_call", name: "private-model", detail: "private-b" },
          ],
        }),
        artifact("traces/a.atf.json", {
          runtime: "r",
          status: "instrumented",
          formatVersion: 1,
          eventCount: 1,
          events: [{ kind: "verification", name: "private-check", detail: "private-c" }],
        }),
      ],
    }

    // When: the same canonical source is normalized twice.
    const first = normalizeAtfObservations(input)
    const second = normalizeAtfObservations(input)

    // Then: ids repeat exactly, distinct source positions differ, and order is not path-sorted.
    expect(first).toEqual(second)
    expect(first.observations.map((observation) => observation.ordinal)).toEqual([0, 1, 2])
    expect(first.observations.map((observation) => observation.source.eventIndex)).toEqual([
      0, 1, 0,
    ])
    expect(
      first.observations.map((observation) => String(observation.source.artifactPath)),
    ).toEqual(["traces/b.atf.json", "traces/b.atf.json", "traces/a.atf.json"])
    expect(new Set(first.observations.map((observation) => observation.id)).size).toBe(3)
  })

  test("normalizes v1-only facts as unavailable", () => {
    // Given: summary-only tool and verification events with no structured payload facts.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/v1.atf.json", {
          runtime: "hermes",
          status: "instrumented",
          formatVersion: 1,
          eventCount: 3,
          events: [
            { kind: "tool_call", name: "private-tool", detail: "private-input" },
            { kind: "tool_result", name: "private-tool", detail: "error" },
            { kind: "verification", name: "private-check", detail: "passed" },
          ],
        }),
      ],
    }

    // When: the v1 trace is normalized.
    const normalized = normalizeAtfObservations(input)

    // Then: detail text is never interpreted as linkage, error, or verification truth.
    expect(normalized.observations[0]?.toolUseLink).toEqual({ status: "unavailable" })
    expect(normalized.observations[1]?.toolUseLink).toEqual({ status: "unavailable" })
    expect(normalized.observations[1]?.error).toEqual({ availability: "unavailable" })
    expect(normalized.observations[2]?.verification).toEqual({ availability: "unavailable" })
    expect(JSON.stringify(normalized)).not.toContain("private-input")
    expect(JSON.stringify(normalized)).not.toContain("passed")
  })

  test("normalizes content-free function boundary direction", () => {
    // Given: function boundaries whose names, details, and payload content are private.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/function-direction.atf.json", {
          runtime: "PRIVATE_RUNTIME",
          status: "collected",
          formatVersion: 2,
          eventCount: 3,
          events: [
            {
              kind: "function_enter",
              name: "PRIVATE_OUTER_FUNCTION",
              detail: "PRIVATE_ENTER_DETAIL",
              payload: { role: "user", content: "PRIVATE_FUNCTION_PAYLOAD" },
            },
            {
              kind: "function_exit",
              name: "PRIVATE_OUTER_FUNCTION",
              detail: "PRIVATE_EXIT_DETAIL",
            },
            { kind: "custom", name: "PRIVATE_OTHER", detail: "PRIVATE_OTHER_DETAIL" },
          ],
        }),
      ],
    }

    // When: canonical event kinds cross the normalized observation boundary.
    const normalized = normalizeAtfObservations(input)

    // Then: only structural enter/exit/not-applicable direction survives.
    expect(
      normalized.observations.map(({ eventClass, functionDirection }) => ({
        eventClass,
        functionDirection,
      })),
    ).toEqual([
      { eventClass: "step", functionDirection: "enter" },
      { eventClass: "step", functionDirection: "exit" },
      { eventClass: "other", functionDirection: "not_applicable" },
    ])
    const serialized = JSON.stringify(normalized)
    for (const forbidden of [
      "PRIVATE_OUTER_FUNCTION",
      "PRIVATE_ENTER_DETAIL",
      "PRIVATE_EXIT_DETAIL",
      "PRIVATE_FUNCTION_PAYLOAD",
      '"name"',
      '"detail"',
      '"payload"',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("classifies unmatched tool links as invalid without retaining link ids", () => {
    // Given: one call and one result carrying different valid v2 link ids.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/unmatched.atf.json", {
          runtime: "claude-code",
          status: "collected",
          formatVersion: 2,
          eventCount: 2,
          events: [
            {
              kind: "tool_call",
              name: "Read",
              detail: "x",
              payload: { toolUseId: "unmatched-call-secret", input: {} },
            },
            {
              kind: "tool_result",
              name: "Read",
              detail: "ok",
              payload: { toolUseId: "unmatched-result-secret", output: "x" },
            },
          ],
        }),
      ],
    }

    // When: linkage is normalized.
    const normalized = normalizeAtfObservations(input)

    // Then: both sides are explicitly invalid and neither source id is serialized.
    expect(normalized.observations[0]?.toolUseLink).toEqual({
      status: "invalid",
      reason: "unmatched_call",
    })
    expect(normalized.observations[1]?.toolUseLink).toEqual({
      status: "invalid",
      reason: "unmatched_result",
    })
    expect(JSON.stringify(normalized)).not.toContain("unmatched-call-secret")
    expect(JSON.stringify(normalized)).not.toContain("unmatched-result-secret")
  })

  test("rejects duplicate tool links with a bounded typed error", () => {
    // Given: two v2 tool calls reuse the same source linkage id.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/duplicate.atf.json", {
          runtime: "claude-code",
          status: "collected",
          formatVersion: 2,
          eventCount: 2,
          events: [
            {
              kind: "tool_call",
              name: "Read",
              detail: "x",
              payload: { toolUseId: "DUPLICATE_PRIVATE_LINK", input: {} },
            },
            {
              kind: "tool_call",
              name: "Read",
              detail: "y",
              payload: { toolUseId: "DUPLICATE_PRIVATE_LINK", input: {} },
            },
          ],
        }),
      ],
    }

    // When: the invalid source linkage is parsed.
    const error = captureError(() => normalizeAtfObservations(input))

    // Then: callers receive a typed reason without the source id.
    expect(error).toBeInstanceOf(TrajectoryObservationError)
    expect(error.code).toBe(TrajectoryObservationErrorCode.InvalidToolLink)
    expect(error.reason).toBe("duplicate_tool_call")
    expect(error.message).not.toContain("DUPLICATE_PRIVATE_LINK")
  })

  test("rejects malformed v2 payloads without echoing source content", () => {
    // Given: a payload whose typed error flag is malformed and whose detail is sensitive.
    const input = {
      archiveSha256,
      artifacts: [
        artifact("traces/malformed.atf.json", {
          runtime: "claude-code",
          status: "collected",
          formatVersion: 2,
          eventCount: 1,
          events: [
            {
              kind: "tool_result",
              name: "Read",
              detail: "MALFORMED_PRIVATE_DETAIL",
              payload: { isError: "false", output: "MALFORMED_PRIVATE_OUTPUT" },
            },
          ],
        }),
      ],
    }

    // When: the strict v2 boundary parses it.
    const error = captureError(() => normalizeAtfObservations(input))

    // Then: the schema error is typed and content-free.
    expect(error).toBeInstanceOf(TrajectoryObservationError)
    expect(error.code).toBe(TrajectoryObservationErrorCode.InvalidAtfSchema)
    expect(error.eventIndex).toBe(0)
    expect(error.message).not.toContain("MALFORMED_PRIVATE_DETAIL")
    expect(error.message).not.toContain("MALFORMED_PRIVATE_OUTPUT")
  })

  test("rejects malformed source identity", () => {
    // Given: valid ATF bytes paired with a traversal artifact path.
    const malformed = artifact("../private.atf.json", {
      runtime: "hermes",
      status: "instrumented",
      eventCount: 0,
      events: [],
    })

    // When: source identity is parsed.
    const error = captureError(() =>
      normalizeAtfObservations({ archiveSha256, artifacts: [malformed] }),
    )

    // Then: the boundary rejects it with the expected typed field and no path echo.
    expect(error).toBeInstanceOf(TrajectoryObservationError)
    expect(error.code).toBe(TrajectoryObservationErrorCode.InvalidSourceIdentity)
    expect(error.field).toBe("artifactPath")
    expect(error.message).not.toContain("../private.atf.json")
  })

  test("rejects hash mismatches and overlong linkage ids", () => {
    // Given: one artifact with a false digest and another with an over-policy link id.
    const falseHashArtifact = {
      ...artifact("traces/hash.atf.json", {
        runtime: "r",
        status: "instrumented",
        eventCount: 0,
        events: [],
      }),
      artifactSha256: "b".repeat(64),
    }
    const boundedPayloadArtifact = artifact("traces/bounded.atf.json", {
      runtime: "r",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [
        {
          kind: "tool_call",
          name: "Read",
          detail: "x",
          payload: { toolUseId: "x".repeat(trajectoryObservationPolicy.maxToolUseIdChars + 1) },
        },
      ],
    })

    // When: each malformed artifact is normalized.
    const hashError = captureError(() =>
      normalizeAtfObservations({ archiveSha256, artifacts: [falseHashArtifact] }),
    )
    const payloadError = captureError(() =>
      normalizeAtfObservations({ archiveSha256, artifacts: [boundedPayloadArtifact] }),
    )

    // Then: both failures are typed at their respective trust boundaries.
    expect(hashError).toBeInstanceOf(TrajectoryObservationError)
    expect(hashError.code).toBe(TrajectoryObservationErrorCode.ArtifactHashMismatch)
    expect(payloadError).toBeInstanceOf(TrajectoryObservationError)
    expect(payloadError.code).toBe(TrajectoryObservationErrorCode.InvalidAtfSchema)
    expect(payloadError.eventIndex).toBe(0)
  })

  test("runtime observation schema rejects indexes beyond policy bounds", () => {
    // Given: one valid normalized observation.
    const observation = normalizedSchemaFixture().observations[0]
    if (observation === undefined) throw new TypeError("expected normalized observation")

    // When: external records exceed the published ordinal and event-index ceilings.
    const ordinalResult = trajectoryObservationSchema.safeParse({
      ...observation,
      ordinal: trajectoryObservationPolicy.maxTotalObservations,
    })
    const eventIndexResult = trajectoryObservationSchema.safeParse({
      ...observation,
      source: {
        ...observation.source,
        eventIndex: trajectoryObservationPolicy.maxEventsPerArtifact,
      },
    })

    // Then: both runtime parses reject the out-of-policy values.
    expect(ordinalResult.success).toBe(false)
    expect(eventIndexResult.success).toBe(false)
  })

  test("runtime observation schema enforces function direction consistency", () => {
    // Given: one normalized function boundary and one non-function observation.
    const normalized = normalizeAtfObservations({
      archiveSha256,
      artifacts: [
        artifact("traces/function-schema.atf.json", {
          runtime: "r",
          status: "instrumented",
          eventCount: 2,
          events: [
            { kind: "function_enter", name: "private-function", detail: "private" },
            { kind: "session_end", name: "private-session", detail: "private" },
          ],
        }),
      ],
    })
    const boundary = normalized.observations[0]
    const nonBoundary = normalized.observations[1]
    if (boundary === undefined || nonBoundary === undefined) {
      throw new TypeError("expected function and non-function observations")
    }

    // When: external records preserve or contradict the structural invariant.
    const validBoundary = trajectoryObservationSchema.safeParse({
      ...boundary,
      functionDirection: "enter",
    })
    const missingBoundaryDirection = trajectoryObservationSchema.safeParse({
      ...boundary,
      functionDirection: "not_applicable",
    })
    const inventedBoundaryDirection = trajectoryObservationSchema.safeParse({
      ...nonBoundary,
      functionDirection: "exit",
    })

    // Then: step iff enter/exit is enforced at the exported runtime boundary.
    expect(validBoundary.success).toBe(true)
    expect(missingBoundaryDirection.success).toBe(false)
    expect(inventedBoundaryDirection.success).toBe(false)
  })

  test("runtime observation set schema rejects inconsistent counts", () => {
    // Given: a valid normalized observation set.
    const normalized = normalizedSchemaFixture()

    // When: summary counts contradict the records and ATF version total.
    const observationCountResult = trajectoryObservationSetSchema.safeParse({
      ...normalized,
      summary: { ...normalized.summary, observationCount: 0 },
    })
    const artifactCountResult = trajectoryObservationSetSchema.safeParse({
      ...normalized,
      summary: {
        ...normalized.summary,
        artifactCount: 2,
        atfVersionCounts: { v1: 1, v2: 0 },
      },
    })

    // Then: contradictory summaries are rejected at the exported schema boundary.
    expect(observationCountResult.success).toBe(false)
    expect(artifactCountResult.success).toBe(false)
  })

  test("runtime observation set schema rejects policy overflow", () => {
    // Given: a valid normalized set with an externally replaced summary.
    const normalized = normalizedSchemaFixture()

    // When: artifact and version counts exceed the published archive ceiling.
    const result = trajectoryObservationSetSchema.safeParse({
      ...normalized,
      summary: {
        ...normalized.summary,
        artifactCount: trajectoryObservationPolicy.maxArtifacts + 1,
        atfVersionCounts: { v1: trajectoryObservationPolicy.maxArtifacts + 1, v2: 0 },
      },
    })

    // Then: the runtime set schema rejects the overflow.
    expect(result.success).toBe(false)
  })

  test("runtime observation set rejects relational duplicate observation ids", () => {
    // Given: two valid content-free observations with distinct source pointers.
    const normalized = normalizedRelationalIdentityFixture()
    const first = normalized.observations[0]
    const second = normalized.observations[1]
    if (first === undefined || second === undefined) throw new TypeError("expected observations")

    // When: an external producer reuses the first observation ID.
    const malformed = {
      ...normalized,
      observations: [first, { ...second, id: first.id }],
    }

    // Then: the exported set schema rejects the duplicate identity.
    expectObservationSetIssue(malformed, "duplicate observation id")
  })

  test("runtime observation set rejects relational duplicate source tuples", () => {
    // Given: two valid observations with distinct deterministic identities.
    const normalized = normalizedRelationalIdentityFixture()
    const first = normalized.observations[0]
    const second = normalized.observations[1]
    if (first === undefined || second === undefined) throw new TypeError("expected observations")

    // When: an external producer reuses the complete first source tuple.
    const malformed = {
      ...normalized,
      observations: [first, { ...second, source: first.source }],
    }

    // Then: the exported set schema rejects the duplicate pointer.
    expectObservationSetIssue(malformed, "duplicate observation source")
  })

  test("runtime observation set rejects relational absent matched counterparts", () => {
    // Given: two valid reciprocal tool-use pairs.
    const normalized = normalizedRelationalToolFixture()
    const call = normalized.observations[0]
    if (call === undefined) throw new TypeError("expected tool call")

    // When: one matched link names a schema-valid ID absent from the set.
    const malformed = {
      ...normalized,
      observations: [
        {
          ...call,
          toolUseLink: {
            status: "matched",
            counterpartObservationId: `obs_${"f".repeat(64)}`,
          },
        },
        ...normalized.observations.slice(1),
      ],
    }

    // Then: the exported set schema rejects the dangling reference.
    expectObservationSetIssue(malformed, "matched counterpart is absent")
  })

  test("runtime observation set rejects relational self matched counterparts", () => {
    // Given: a valid matched tool call.
    const normalized = normalizedRelationalToolFixture()
    const call = normalized.observations[0]
    if (call === undefined) throw new TypeError("expected tool call")

    // When: the call is externally changed to point to itself.
    const malformed = {
      ...normalized,
      observations: [
        {
          ...call,
          toolUseLink: { status: "matched", counterpartObservationId: call.id },
        },
        ...normalized.observations.slice(1),
      ],
    }

    // Then: self-linkage is rejected explicitly.
    expectObservationSetIssue(malformed, "matched counterpart is self")
  })

  test("runtime observation set rejects relational nonreciprocal matched links", () => {
    // Given: two independent reciprocal tool-use pairs.
    const normalized = normalizedRelationalToolFixture()
    const firstCall = normalized.observations[0]
    const secondResult = normalized.observations[3]
    if (firstCall === undefined || secondResult === undefined) {
      throw new TypeError("expected tool observations")
    }

    // When: the first call points at the other pair's result.
    const malformed = {
      ...normalized,
      observations: [
        {
          ...firstCall,
          toolUseLink: {
            status: "matched",
            counterpartObservationId: secondResult.id,
          },
        },
        ...normalized.observations.slice(1),
      ],
    }

    // Then: the existing but nonreciprocal relationship is rejected.
    expectObservationSetIssue(malformed, "matched link is not reciprocal")
  })

  test("runtime observation set rejects relational invalid matched event classes", () => {
    // Given: two valid non-tool observations with present, distinct identities.
    const normalized = normalizedRelationalIdentityFixture()
    const first = normalized.observations[0]
    const second = normalized.observations[1]
    if (first === undefined || second === undefined) throw new TypeError("expected observations")

    // When: an external producer adds reciprocal matched links to the non-tool events.
    const malformed = {
      ...normalized,
      observations: [
        {
          ...first,
          toolUseLink: { status: "matched", counterpartObservationId: second.id },
        },
        {
          ...second,
          toolUseLink: { status: "matched", counterpartObservationId: first.id },
        },
      ],
    }

    // Then: matched linkage requires exactly one call and one result.
    expectObservationSetIssue(malformed, "matched event classes are invalid")
  })
})
