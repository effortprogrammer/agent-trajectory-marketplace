import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

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
})
