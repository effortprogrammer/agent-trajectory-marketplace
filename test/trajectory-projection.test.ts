import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { z } from "zod"
import { deriveTrajectoryMetrics } from "../src/trajectory/metrics"
import { normalizeAtfObservations } from "../src/trajectory/observation"
import {
  createTrajectoryProjection,
  openInferenceProjectionSchema,
  otelGenAiProjectionSchema,
  TrajectoryProjectionError,
  trajectoryProjectionManifestSchema,
  trajectoryProjectionProfiles,
} from "../src/trajectory/projections"

const sourceBytes = (document: unknown): Uint8Array => Buffer.from(JSON.stringify(document), "utf8")

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex")

// Future projection contract not yet shipped in src/trajectory/projection-contract.ts.
const futureSpanMetadataSchema = z.object({
  startTime: z.string().min(1),
  parentSpanIndex: z.number().int().nonnegative().nullable(),
})

const v1Fixture = () =>
  sourceBytes({
    runtime: "PRIVATE_RUNTIME_SENTINEL",
    status: "instrumented",
    eventCount: 2,
    events: [
      { kind: "session_start", name: "PRIVATE_SESSION_SENTINEL", detail: "private" },
      { kind: "llm_call", name: "PRIVATE_MODEL_SENTINEL", detail: "private" },
    ],
  })

const v2Fixture = () =>
  sourceBytes({
    runtime: "PRIVATE_RUNTIME_SENTINEL",
    status: "collected",
    formatVersion: 2,
    eventCount: 2,
    events: [
      {
        kind: "llm_call",
        name: "PRIVATE_MODEL_SENTINEL",
        detail: "private",
        payload: {
          usage: {
            model: "PRIVATE_MODEL_SENTINEL",
            inputTokens: 10,
            outputTokens: 4,
            latencyMs: 25,
          },
        },
      },
      {
        kind: "tool_result",
        name: "PRIVATE_TOOL_SENTINEL",
        detail: "private",
        payload: { toolUseId: "PRIVATE_LINK_SENTINEL", output: "private", isError: true },
      },
    ],
  })

const v2FixtureWithSourceMetadata = () =>
  sourceBytes({
    runtime: "PRIVATE_RUNTIME_SENTINEL",
    status: "collected",
    formatVersion: 2,
    eventCount: 2,
    events: [
      {
        kind: "llm_call",
        name: "PRIVATE_MODEL_SENTINEL",
        detail: "private",
        timestamp: "2025-01-01T00:00:00.000Z",
        sourceEventId: "src-evt-aa",
        payload: {
          usage: { model: "PRIVATE_MODEL_SENTINEL", inputTokens: 10, outputTokens: 4 },
        },
      },
      {
        kind: "tool_result",
        name: "PRIVATE_TOOL_SENTINEL",
        detail: "private",
        timestamp: "2025-01-01T00:00:01.000Z",
        sourceEventId: "src-evt-bb",
        parentSourceEventId: "src-evt-aa",
        payload: { toolUseId: "PRIVATE_LINK_SENTINEL", output: "private", isError: true },
      },
    ],
  })

const v2FixtureWithUnverifiedParent = () =>
  sourceBytes({
    runtime: "PRIVATE_RUNTIME_SENTINEL",
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [
      {
        kind: "tool_result",
        name: "PRIVATE_TOOL_SENTINEL",
        detail: "private",
        timestamp: "2025-01-01T00:00:02.000Z",
        sourceEventId: "src-evt-cc",
        parentSourceEventId: "src-evt-missing",
        payload: { toolUseId: "PRIVATE_LINK_SENTINEL", output: "private", isError: false },
      },
    ],
  })

const v2FixtureWithForwardAttestedParent = () =>
  sourceBytes({
    runtime: "PRIVATE_RUNTIME_SENTINEL",
    status: "collected",
    formatVersion: 2,
    eventCount: 2,
    events: [
      {
        kind: "tool_result",
        name: "PRIVATE_TOOL_SENTINEL",
        detail: "private",
        timestamp: "2025-01-01T00:00:00.000Z",
        sourceEventId: "src-evt-child",
        parentSourceEventId: "src-root",
        payload: { toolUseId: "PRIVATE_LINK_SENTINEL", output: "private", isError: false },
      },
      {
        kind: "llm_call",
        name: "PRIVATE_MODEL_SENTINEL",
        detail: "private",
        timestamp: "2025-01-01T00:00:01.000Z",
        sourceEventId: "src-root",
        payload: { usage: { model: "PRIVATE_MODEL_SENTINEL", inputTokens: 4 } },
      },
    ],
  })

describe("trajectory projection profiles", () => {
  test("pins supported projection profiles", () => {
    // Given: the two explicitly supported interoperability profiles.
    const expected = {
      otelGenAi: {
        name: "otel-genai",
        specification: "open-telemetry/semantic-conventions-genai",
        specificationVersion: "9a6b37347841bcb5a85110c41ac19c54c4200319",
        projectionSchemaVersion: 1,
      },
      openInference: {
        name: "openinference",
        specification: "Arize-ai/openinference",
        specificationVersion: "a8992df9f443b743c697decc4b659811d5b78d2d",
        projectionSchemaVersion: 1,
      },
    } as const

    // When: callers inspect the pinned profile table.
    const profiles = trajectoryProjectionProfiles

    // Then: profile identity is exact and reviewable rather than floating.
    expect(profiles).toEqual(expected)
  })

  test("projects deterministic OTel GenAI v1 golden", () => {
    // Given: a canonical summary-only ATF v1 document.
    const bytes = v1Fixture()

    // When: the same bytes are projected twice.
    const first = createTrajectoryProjection({ profile: "otel-genai", sourceBytes: bytes })
    const second = createTrajectoryProjection({ profile: "otel-genai", sourceBytes: bytes })

    // Then: the local schema and exact golden shape are stable.
    expect(first).toEqual(second)
    expect(otelGenAiProjectionSchema.parse(first.projection)).toEqual({
      schemaVersion: 1,
      kind: "otel-genai-projection",
      profile: trajectoryProjectionProfiles.otelGenAi,
      resource: {
        attributes: { "service.name": "agent-trajectory-marketplace.local-projection" },
      },
      spans: [
        {
          name: "atf.session",
          kind: "INTERNAL",
          attributes: { "atf.event.class": "session" },
          status: { code: "UNSET" },
        },
        {
          name: "atf.llm",
          kind: "INTERNAL",
          attributes: {
            "atf.event.class": "llm",
            "gen_ai.operation.name": "chat",
          },
          status: { code: "UNSET" },
        },
      ],
    })
    const manifest = trajectoryProjectionManifestSchema.parse(first.manifest)
    expect(manifest.source).toEqual({ sha256: sha256(bytes), atfFormatVersion: 1, eventCount: 2 })
    expect(manifest.events.map(({ source }) => source)).toEqual([
      { pointerPath: "/events/0", eventIndex: 0 },
      { pointerPath: "/events/1", eventIndex: 1 },
    ])
    // biome-ignore format: Exact golden target order is clearer as one compact sequence.
    expect(manifest.events[1]?.transformedFields.map(({ targetPath }) => targetPath)).toEqual(["/spans/1/name", "/spans/1/attributes/atf.event.class", "/spans/1/attributes/gen_ai.operation.name"])
  })

  test("projects deterministic OpenInference v2 golden", () => {
    // Given: a canonical v2 document with usage and error facts.
    const bytes = v2Fixture()

    // When: OpenInference projection is derived.
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })

    // Then: only structural and scalar facts enter the pinned projection.
    expect(openInferenceProjectionSchema.parse(result.projection)).toEqual({
      schemaVersion: 1,
      kind: "openinference-projection",
      profile: trajectoryProjectionProfiles.openInference,
      spans: [
        {
          name: "atf.llm",
          attributes: {
            "openinference.span.kind": "LLM",
            "llm.token_count.prompt": 10,
            "llm.token_count.completion": 4,
          },
          status: { code: "UNSET" },
        },
        {
          name: "atf.tool_result",
          attributes: {
            "openinference.span.kind": "TOOL",
            "atf.result.is_error": true,
          },
          status: { code: "ERROR" },
        },
      ],
    })
    expect(result.manifest.events.map(({ target }) => target.pointerPath)).toEqual([
      "/spans/0",
      "/spans/1",
    ])
  })

  test("records lossy unsupported fields", () => {
    // Given: canonical v2 events carrying content, redaction, truncation, and source linkage.
    const bytes = sourceBytes({
      runtime: "PRIVATE_RUNTIME_SENTINEL",
      status: "collected",
      formatVersion: 2,
      eventCount: 4,
      events: [
        {
          kind: "llm_call",
          name: "PRIVATE_MODEL_SENTINEL",
          detail: "PRIVATE_DETAIL_SENTINEL [redacted]",
          payload: {
            role: "user",
            content: "PRIVATE_PROMPT_SENTINEL [pii:email]",
            truncated: true,
            usage: { model: "PRIVATE_MODEL_SENTINEL", latencyMs: 9 },
          },
        },
        {
          kind: "tool_call",
          name: "PRIVATE_TOOL_SENTINEL",
          detail: "private",
          // biome-ignore format: Compact adversarial payload keeps this test at the size ceiling.
          payload: { toolUseId: "PRIVATE_LINK_SENTINEL", input: { PRIVATE_DYNAMIC_KEY_SENTINEL: "[redacted]" } },
        },
        {
          kind: "tool_result",
          name: "PRIVATE_TOOL_SENTINEL",
          detail: "private",
          payload: {
            toolUseId: "PRIVATE_LINK_SENTINEL",
            output: "PRIVATE_OUTPUT_SENTINEL",
            byteCount: 99,
            isError: false,
          },
        },
        {
          kind: "verification",
          name: "PRIVATE_CHECK_SENTINEL",
          detail: "private",
          payload: { passed: true, label: "PRIVATE_LABEL_SENTINEL" },
        },
      ],
    })

    // When: the projection and mapping/loss manifest are derived.
    const result = createTrajectoryProjection({ profile: "otel-genai", sourceBytes: bytes })

    // Then: every lossy class is explicit and source identity is not regenerated.
    const manifest = trajectoryProjectionManifestSchema.parse(result.manifest)
    expect(manifest.reconstruction).toBe("not_supported")
    expect(manifest.identity).toEqual({
      sourceHashPreserved: true,
      generatedTraceIds: false,
      generatedSpanIds: false,
    })
    expect(manifest.events[0]?.truncation).toContainEqual({
      sourcePath: "/events/0/payload",
      reason: "source_marked_truncated",
    })
    expect(manifest.events[0]?.redaction.map(({ sourcePath }) => sourcePath)).toEqual([
      "/events/0/detail",
      "/events/0/payload/content",
    ])
    expect(manifest.events[1]?.unsupported).toContainEqual({
      sourcePath: "/events/1/payload/toolUseId",
      reason: "source_link_identity_not_projected",
    })
    // biome-ignore format: The compact assertion keeps this focused test at the size ceiling.
    expect(manifest.events[1]?.redaction).toContainEqual({ sourcePath: "/events/1/payload/input", reason: "source_redaction_marker" })
    expect(manifest.events[2]?.unsupported).toContainEqual({
      sourcePath: "/events/2/payload/byteCount",
      reason: "no_supported_profile_field",
    })
    const serialized = JSON.stringify(result)
    // biome-ignore format: Compact sentinel list keeps this focused test file below the size ceiling.
    for (const forbidden of ["PRIVATE_RUNTIME_SENTINEL", "PRIVATE_MODEL_SENTINEL", "PRIVATE_DETAIL_SENTINEL", "PRIVATE_PROMPT_SENTINEL", "PRIVATE_LINK_SENTINEL", "PRIVATE_DYNAMIC_KEY_SENTINEL", "PRIVATE_OUTPUT_SENTINEL", "PRIVATE_LABEL_SENTINEL", "traceId", "spanId", "parentSpanId"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("rejects projection configuration fields", () => {
    // Given: otherwise valid local projection input carrying forbidden runtime destinations.
    const bytes = v1Fixture()
    const inputs: readonly unknown[] = [
      { profile: "otel-genai", sourceBytes: bytes, destination: "https://collector.invalid" },
      { profile: "otel-genai", sourceBytes: bytes, collector: "localhost:4318" },
      { profile: "otel-genai", sourceBytes: bytes, network: true },
      { profile: "otel-genai", sourceBytes: bytes, import: "otlp" },
    ]

    // When: each unapproved configuration shape crosses the boundary.
    const actions = inputs.map((input) => () => createTrajectoryProjection(input))

    // Then: all are rejected before projection work starts.
    for (const action of actions) {
      expect(action).toThrow(TrajectoryProjectionError)
      expect(action).toThrow("invalid_projection_request")
    }
  })

  test("cannot be accepted as canonical metrics input", () => {
    // Given: a valid derived projection document.
    const result = createTrajectoryProjection({
      profile: "openinference",
      sourceBytes: v2Fixture(),
    })
    const projectedBytes = sourceBytes(result.projection)

    // When: canonical observation and metric boundaries receive the derived document.
    const normalize = () =>
      normalizeAtfObservations({
        archiveSha256: "a".repeat(64),
        artifacts: [
          {
            artifactPath: "traces/projection.atf.json",
            artifactSha256: sha256(projectedBytes),
            sourceBytes: projectedBytes,
          },
        ],
      })
    const deriveMetrics = () => deriveTrajectoryMetrics(result.projection)

    // Then: neither canonical boundary accepts a projection as source truth.
    expect(normalize).toThrow("invalid_atf_schema")
    expect(deriveMetrics).toThrow("invalid_normalized_observation_set")
  })

  test("projects v2 source-attested startTime and parentSpanIndex", () => {
    // Given: a v2 document carrying event-level source attestation.
    const bytes = v2FixtureWithSourceMetadata()

    // When: OpenInference projection is derived.
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })

    // Then: source-attested timing and parent linkage survive into the projection.
    const spans = futureSpanMetadataSchema.array().parse(result.projection.spans)
    expect(spans).toEqual([
      { startTime: "2025-01-01T00:00:00.000Z", parentSpanIndex: null },
      { startTime: "2025-01-01T00:00:01.000Z", parentSpanIndex: 0 },
    ])
  })

  test("records source metadata mapping loss for source-attested events", () => {
    // Given: a v2 document where the first event is a root and the second is a resolved child.
    const bytes = v2FixtureWithSourceMetadata()

    // When: OpenInference projection and mapping/loss manifest are derived.
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })
    const manifest = trajectoryProjectionManifestSchema.parse(result.manifest)

    // Then: every source-attested event records sourceEventId as unsupported identity loss,
    // the root event's null parentSpanIndex is recorded as defaulted, and the resolved
    // child's parentSpanIndex is transformed rather than defaulted.
    expect(manifest.events[0]?.unsupported).toContainEqual({
      sourcePath: "/events/0/sourceEventId",
      reason: "source_link_identity_not_projected",
    })
    expect(manifest.events[1]?.unsupported).toContainEqual({
      sourcePath: "/events/1/sourceEventId",
      reason: "source_link_identity_not_projected",
    })
    expect(manifest.events[0]?.defaultedFields).toContainEqual({
      targetPath: "/spans/0/parentSpanIndex",
      value: null,
      reason: "source_parent_index_unavailable",
    })
    expect(manifest.events[1]?.transformedFields).toContainEqual({
      sourcePath: "/events/1/parentSourceEventId",
      targetPath: "/spans/1/parentSpanIndex",
      operation: "resolve_source_parent_event_index",
    })
    expect(
      manifest.events[1]?.defaultedFields.filter(
        (entry) => entry.targetPath === "/spans/1/parentSpanIndex",
      ),
    ).toEqual([])
  })

  test("records mapping loss for unresolved parent source linkage", () => {
    // Given: a v2 event whose parentSourceEventId resolves to no known source event.
    const bytes = v2FixtureWithUnverifiedParent()

    // When: the projection and mapping/loss manifest are derived.
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })

    // Then: the unresolved parent reference is not projected, the null parentSpanIndex
    // is recorded as defaulted, and the projection carries null parent linkage.
    const manifest = trajectoryProjectionManifestSchema.parse(result.manifest)
    expect(manifest.events[0]?.unsupported).toContainEqual({
      sourcePath: "/events/0/parentSourceEventId",
      reason: "source_parent_linkage_unresolved",
    })
    expect(manifest.events[0]?.defaultedFields).toContainEqual({
      targetPath: "/spans/0/parentSpanIndex",
      value: null,
      reason: "source_parent_index_unavailable",
    })
    const spans = futureSpanMetadataSchema.array().parse(result.projection.spans)
    expect(spans.map(({ parentSpanIndex }) => parentSpanIndex)).toEqual([null])
  })

  test("projects v2 source-attested parent that references a later source event", () => {
    // Given: a v2 document where event 0 attests a parentSourceEventId ("src-root")
    // that is only carried by a later event in document order, while event 0 itself
    // is not self-parented.
    const bytes = v2FixtureWithForwardAttestedParent()

    // When: OpenInference projection and mapping/loss manifest are derived.
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })

    // Then: the later source event is the verified parent, the forward reference is
    // transformed rather than defaulted, and no unresolved parent loss is recorded.
    const spans = futureSpanMetadataSchema.array().parse(result.projection.spans)
    expect(spans.map(({ parentSpanIndex }) => parentSpanIndex)).toEqual([1, null])
    const manifest = trajectoryProjectionManifestSchema.parse(result.manifest)
    expect(manifest.events[0]?.transformedFields).toContainEqual({
      sourcePath: "/events/0/parentSourceEventId",
      targetPath: "/spans/0/parentSpanIndex",
      operation: "resolve_source_parent_event_index",
    })
    expect(
      manifest.events[0]?.defaultedFields.filter(
        (entry) => entry.targetPath === "/spans/0/parentSpanIndex",
      ),
    ).toEqual([])
    expect(manifest.events[0]?.unsupported).not.toContainEqual({
      sourcePath: "/events/0/parentSourceEventId",
      reason: "source_parent_linkage_unresolved",
    })
    // Private source identifiers must not leak through the projection surface.
    const serialized = JSON.stringify(result)
    // biome-ignore format: Compact sentinel list keeps this focused test at the size ceiling.
    for (const forbidden of ["PRIVATE_RUNTIME_SENTINEL", "PRIVATE_MODEL_SENTINEL", "PRIVATE_TOOL_SENTINEL", "PRIVATE_LINK_SENTINEL"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("rejects incomplete source-attestation metadata", () => {
    // Given: otherwise valid v2 documents carrying partial event-level source attestation.
    const baseDocument = {
      runtime: "PRIVATE_RUNTIME_SENTINEL",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
    }
    const baseEvent = {
      kind: "llm_call",
      name: "PRIVATE_MODEL_SENTINEL",
      detail: "private",
      payload: { usage: { model: "PRIVATE_MODEL_SENTINEL", inputTokens: 1 } },
    }
    const inputs: readonly unknown[] = [
      {
        ...baseDocument,
        events: [{ ...baseEvent, parentSourceEventId: "src-evt-orphan" }],
      },
      {
        ...baseDocument,
        events: [{ ...baseEvent, sourceEventId: "src-evt-lone" }],
      },
      {
        ...baseDocument,
        events: [{ ...baseEvent, timestamp: "2025-01-01T00:00:00.000Z" }],
      },
    ]

    // When: each partial metadata shape crosses the strict ATF boundary.
    const actions = inputs.map(
      (document) => () =>
        createTrajectoryProjection({
          profile: "openinference",
          sourceBytes: sourceBytes(document),
        }),
    )

    // Then: every partial attestation is rejected before projection work proceeds.
    for (const action of actions) {
      expect(action).toThrow("invalid_atf_schema")
    }
  })

  test("rejects duplicate sourceEventId values before ambiguous parent projection", () => {
    // Given: a v2 document where two events share the same sourceEventId.
    const bytes = sourceBytes({
      runtime: "PRIVATE_RUNTIME_SENTINEL",
      status: "collected",
      formatVersion: 2,
      eventCount: 2,
      events: [
        {
          kind: "llm_call",
          name: "PRIVATE_MODEL_SENTINEL",
          detail: "private",
          timestamp: "2025-01-01T00:00:00.000Z",
          sourceEventId: "src-evt-dup",
          payload: { usage: { model: "PRIVATE_MODEL_SENTINEL", inputTokens: 1 } },
        },
        {
          kind: "tool_result",
          name: "PRIVATE_TOOL_SENTINEL",
          detail: "private",
          timestamp: "2025-01-01T00:00:01.000Z",
          sourceEventId: "src-evt-dup",
          payload: { toolUseId: "PRIVATE_LINK_SENTINEL", output: "private", isError: false },
        },
      ],
    })

    // When: the duplicate-bearing document crosses the strict ATF boundary.
    const project = () =>
      createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })

    // Then: the duplicate sourceEventId is rejected before any last-wins overwrite can pick a winner.
    expect(project).toThrow("invalid_atf_schema")
  })

  test("rejects impossible calendar and time component values in source timestamps", () => {
    // Given: otherwise valid v2 events carrying source-attested timestamps whose lexical
    // shape satisfies the ISO 8601 regex but whose calendar/time components are impossible.
    const baseDocument = {
      runtime: "PRIVATE_RUNTIME_SENTINEL",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
    }
    const baseEvent = {
      kind: "llm_call",
      name: "PRIVATE_MODEL_SENTINEL",
      detail: "private",
      sourceEventId: "src-evt-ts",
      payload: { usage: { model: "PRIVATE_MODEL_SENTINEL", inputTokens: 1 } },
    }
    const impossibleTimestamps: readonly string[] = [
      "2025-99-99T99:99:99Z",
      "2025-02-30T00:00:00Z",
      "2025-01-01T24:00:00Z",
    ]
    const inputs = impossibleTimestamps.map((timestamp) => ({
      ...baseDocument,
      events: [{ ...baseEvent, timestamp }],
    }))

    // When: each impossible timestamp crosses the strict ATF boundary.
    const actions = inputs.map(
      (document) => () =>
        createTrajectoryProjection({
          profile: "openinference",
          sourceBytes: sourceBytes(document),
        }),
    )

    // Then: every impossible calendar/time component is rejected rather than lexically accepted.
    for (const action of actions) {
      expect(action).toThrow("invalid_atf_schema")
    }
  })

  test("leaves v1 projection free of synthesized source metadata", () => {
    // Given: a canonical v1 document without event-level source attestation.
    const bytes = v1Fixture()

    // When: the OTel GenAI projection is derived.
    const result = createTrajectoryProjection({ profile: "otel-genai", sourceBytes: bytes })

    // Then: the legacy projection never synthesizes source-attested span metadata.
    expect(futureSpanMetadataSchema.array().safeParse(result.projection.spans).success).toBe(false)
    const serialized = JSON.stringify(result.projection)
    expect(serialized).not.toContain("startTime")
    expect(serialized).not.toContain("parentSpanIndex")
  })

  test("forbids synthesized trace and span identifiers in source metadata projection", () => {
    // Given: a v2 document with event-level source attestation.
    const bytes = v2FixtureWithSourceMetadata()

    // When: OpenInference projection is derived.
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes: bytes })

    // Then: source metadata never regenerates trace/span identifiers.
    const serialized = JSON.stringify(result)
    // biome-ignore format: Compact sentinel list keeps this focused test at the size ceiling.
    for (const forbidden of ["traceId", "spanId", "parentSpanId"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
