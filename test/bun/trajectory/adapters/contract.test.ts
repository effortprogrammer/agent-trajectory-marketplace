import { describe, expect, test } from "bun:test";

import {
  boundedRedactedString,
  extractHarnessSourceAttestation,
  harnessPayloadPolicy,
  harnessTraceDocumentSchema,
  harnessTraceEventSchema,
  sanitizeHarnessPayload,
} from "../../../../src/trajectory/adapters/contract";

const validTimestamp = "2026-07-18T12:34:56.000Z";
const minimalEvent = { kind: "function_enter", name: "turn-1" };

describe("harnessTraceDocumentSchema ATF v2", () => {
  test("accepts a source-attested payload event when the ATF version is 2", () => {
    // Given: an ATF v2 event carrying native source identity and a structured payload.
    const document = {
      runtime: "claude-code",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [
        {
          kind: "tool_call",
          name: "terminal",
          timestamp: validTimestamp,
          sourceEventId: "evt-1",
          payload: { toolUseId: "call-1", input: { command: "rg login src/" } },
        },
      ],
    };

    // When: the richer document crosses the collector contract boundary.
    const result = harnessTraceDocumentSchema.safeParse(document);

    // Then: the validated contract retains the source ID and structured input.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.events[0]?.sourceEventId).toBe("evt-1");
      expect(result.data.events[0]?.payload?.input).toEqual({ command: "rg login src/" });
    }
  });

  test("rejects payloads or source attestation outside an ATF v2 envelope", () => {
    // Given: a source-attested payload event in an otherwise legacy document.
    const document = {
      runtime: "claude-code",
      status: "collected",
      eventCount: 1,
      events: [
        {
          ...minimalEvent,
          timestamp: validTimestamp,
          sourceEventId: "evt-1",
          payload: { output: "done" },
        },
      ],
    };

    // When: the document is validated without formatVersion 2.
    const result = harnessTraceDocumentSchema.safeParse(document);

    // Then: the version invariant is reported structurally.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message)).toContain(
        "format_version_2_required_with_payload_or_source_attestation",
      );
    }
  });

  test("rejects an event count that disagrees with the event array", () => {
    // Given: a summary document whose declared count is stale.
    const document = {
      runtime: "codex",
      status: "collected",
      eventCount: 2,
      events: [minimalEvent],
    };

    // When: the document crosses the contract boundary.
    const result = harnessTraceDocumentSchema.safeParse(document);

    // Then: count mismatch is a typed validation issue.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message)).toContain(
        "event_count_mismatch",
      );
    }
  });

  test("rejects duplicate native source event IDs", () => {
    // Given: two separately timestamped events that claim the same native ID.
    const document = {
      runtime: "claude-code",
      status: "collected",
      formatVersion: 2,
      eventCount: 2,
      events: [
        { ...minimalEvent, timestamp: validTimestamp, sourceEventId: "duplicate" },
        {
          ...minimalEvent,
          timestamp: "2026-07-18T12:34:57.000Z",
          sourceEventId: "duplicate",
        },
      ],
    };

    // When: the document is validated.
    const result = harnessTraceDocumentSchema.safeParse(document);

    // Then: the second source ID is rejected as ambiguous.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: "duplicate_source_event_id",
          path: ["events", 1, "sourceEventId"],
        }),
      );
    }
  });

  test("keeps collected as the only accepted collector status", () => {
    // Given: a structurally valid document stamped with a prototype status.
    const document = {
      runtime: "codex",
      status: "instrumented",
      eventCount: 1,
      events: [minimalEvent],
    };

    // When: the document is validated.
    const result = harnessTraceDocumentSchema.safeParse(document);

    // Then: non-collected output is rejected.
    expect(result.success).toBe(false);
  });
});

describe("harnessTraceEventSchema source attestation", () => {
  test("rejects the retired detail field", () => {
    // Given: an event encoded with the retired preview field.
    const event = { ...minimalEvent, detail: "legacy preview" };

    // When: it crosses the ATF event boundary.
    const result = harnessTraceEventSchema.safeParse(event);

    // Then: ATF rejects the duplicate representation rather than persisting it.
    expect(result.success).toBe(false);
  });

  test("rejects malformed and partial source attestation groups", () => {
    // Given: malformed or incomplete variants that cannot prove native provenance.
    const invalidEvents = [
      { ...minimalEvent, timestamp: validTimestamp },
      { ...minimalEvent, sourceEventId: "evt-1" },
      { ...minimalEvent, parentSourceEventId: "evt-0" },
      { ...minimalEvent, timestamp: "2026/07/18 12:34:56", sourceEventId: "evt-1" },
      { ...minimalEvent, timestamp: validTimestamp, sourceEventId: "x".repeat(257) },
    ];

    // When: each event crosses the event contract boundary.
    const results = invalidEvents.map((event) => harnessTraceEventSchema.safeParse(event));

    // Then: no malformed or partial variant is accepted.
    expect(results.every((result) => !result.success)).toBe(true);
  });

  test("extracts only a complete valid group and omits an invalid optional parent", () => {
    // Given: a valid required group with an invalid empty parent ID.
    const raw = {
      timestamp: validTimestamp,
      sourceEventId: "evt-2",
      parentSourceEventId: "",
      ignored: "source-specific field",
    };

    // When: an adapter extracts source metadata from an unknown raw entry.
    const result = extractHarnessSourceAttestation(raw);

    // Then: validated required fields survive without synthesizing a parent.
    expect(result).toEqual({ timestamp: validTimestamp, sourceEventId: "evt-2" });
    expect(extractHarnessSourceAttestation({ sourceEventId: "evt-2" })).toBeUndefined();
  });
});

describe("collector redaction and payload bounds", () => {
  test("rejects pathological payload graphs without recursion", () => {
    // Given: deeply nested, cyclic, and shared-reference values from an adapter payload.
    let deeplyNested: unknown = "leaf";
    for (let depth = 0; depth < 100_000; depth += 1) {
      deeplyNested = { child: deeplyNested };
    }
    const cyclicObject: { self?: unknown } = {};
    cyclicObject.self = cyclicObject;
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    const sharedReference = { diagnostic: "keep me" };

    // When: every graph crosses the collection-time sanitizer.
    const results = [
      sanitizeHarnessPayload({ input: deeplyNested }),
      sanitizeHarnessPayload({ input: cyclicObject }),
      sanitizeHarnessPayload({ input: cyclicArray }),
      sanitizeHarnessPayload({ input: [sharedReference, sharedReference] }),
    ];

    // Then: unsafe graphs fail closed while a non-cyclic DAG remains valid.
    expect(results[0]).toBeUndefined();
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBeUndefined();
    expect(results[3]).toEqual({
      input: [{ diagnostic: "keep me" }, { diagnostic: "keep me" }],
    });
  });

  test("accepts depth 256 and rejects depth 257 payload values", () => {
    // Given: iteratively constructed values at the traversal boundary.
    let accepted: unknown = "leaf";
    let rejected: unknown = "leaf";
    for (let depth = 0; depth < 257; depth += 1) {
      if (depth < 256) accepted = { child: accepted };
      rejected = { child: rejected };
    }

    // When: both values cross the collection-time sanitizer.
    const acceptedResult = sanitizeHarnessPayload({ input: accepted });
    const rejectedResult = sanitizeHarnessPayload({ input: rejected });

    // Then: the documented depth limit is inclusive at 256.
    expect(acceptedResult).toBeDefined();
    expect(rejectedResult).toBeUndefined();
  });

  test("accepts 65,536 and rejects 65,537 traversed payload values", () => {
    // Given: payload values exactly at and immediately beyond the traversal budget.
    const accepted = Array.from({ length: 65_535 }, () => "value");
    const rejected = Array.from({ length: 65_536 }, () => "value");
    const sparseRejected = new Array<unknown>(65_536);

    // When: both values cross the collection-time sanitizer.
    const acceptedResult = sanitizeHarnessPayload({ input: accepted });
    const rejectedResult = sanitizeHarnessPayload({ input: rejected });
    const sparseRejectedResult = sanitizeHarnessPayload({ input: sparseRejected });

    // Then: the schema envelope does not consume arbitrary-value traversal budget.
    expect(acceptedResult).toEqual({ truncated: true });
    expect(rejectedResult).toBeUndefined();
    expect(sparseRejectedResult).toBeUndefined();
  });

  test("redacts credential-shaped strings at every nested payload leaf", () => {
    // Given: secrets spread across content, object, array, and assistant-block leaves.
    const payload = {
      content: [
        {
          type: "tool_use" as const,
          input: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz" },
        },
      ],
      input: {
        command: "API_KEY=abcdefghijklmnop",
        nested: ["ghp_abcdefghijklmnopqrstuvwxyz123456"],
      },
      output: "xoxb-1234567890-abcdefghijklmnop",
      label: "token count is harmless",
    };

    // When: the payload is sanitized at collection time.
    const result = sanitizeHarnessPayload(payload);

    // Then: every credential span is removed while harmless context survives.
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(result)).not.toContain("xoxb-");
    expect(result?.label).toBe("token count is harmless");
  });

  test("redacts plaintext beneath nested sensitive keys", () => {
    // Given: nested secret fields whose values do not match a credential pattern.
    const payload = {
      input: {
        credentials: {
          password: "plain-password-value",
          passwd: "plain-passwd-value",
          auth: "plain-auth-value",
          authorization: "plain-authorization-value",
          token: "plain-token-value",
          apiToken: "plain-api-token-value",
          key: "plain-key-value",
          api_key: "plain-api-key-value",
          apikey: "plain-apikey-value",
          secret: "plain-secret-value",
          clientSecret: "plain-client-secret-value",
        },
        nested: [{ refresh_token: "plain-refresh-token-value" }],
        harmless: "keep this diagnostic",
      },
    };

    // When: the payload is sanitized at collection time.
    const result = sanitizeHarnessPayload(payload);
    const serialized = JSON.stringify(result);

    // Then: every sensitive value is replaced while unrelated context survives.
    for (const value of [
      "plain-password-value",
      "plain-passwd-value",
      "plain-auth-value",
      "plain-authorization-value",
      "plain-token-value",
      "plain-api-token-value",
      "plain-key-value",
      "plain-api-key-value",
      "plain-apikey-value",
      "plain-secret-value",
      "plain-client-secret-value",
      "plain-refresh-token-value",
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).toContain("keep this diagnostic");
  });

  test("caps each UTF-8 string without splitting a code point", () => {
    // Given: a multibyte string beyond the collection-time leaf limit.
    const oversized = "한".repeat(harnessPayloadPolicy.maxStringBytes);

    // When: the leaf is bounded and redacted.
    const result = boundedRedactedString(oversized);

    // Then: it fits the byte limit and retains an explicit truncation marker.
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
      harnessPayloadPolicy.maxStringBytes,
    );
    expect(result.text.endsWith("…[truncated]")).toBe(true);
  });

  test("collapses an aggregate payload beyond the serialized byte cap", () => {
    // Given: individually bounded leaves whose aggregate exceeds the payload budget.
    const leaf = "x".repeat(harnessPayloadPolicy.maxStringBytes);
    const payload = {
      content: leaf,
      input: { command: leaf, cwd: leaf, path: leaf, query: leaf },
      output: { stdout: leaf, stderr: leaf },
      label: leaf,
    };

    // When: the full payload is sanitized.
    const result = sanitizeHarnessPayload(payload);

    // Then: it becomes a bounded explicit truncation receipt.
    expect(result).toEqual({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
      harnessPayloadPolicy.maxSerializedBytes,
    );
  });

});
