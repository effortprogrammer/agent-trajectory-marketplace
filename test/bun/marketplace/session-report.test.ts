import { describe, expect, test } from "bun:test";

import {
  buildSessionListItem,
  buildSessionReport,
  renderSessionList,
  renderSessionReport,
} from "../../../src/marketplace/session-report";
import {
  fullSelectorSchema,
  traceHashSchema,
  type SessionList,
  type SessionReport,
  type ValidatedTrace,
} from "../../../src/marketplace/session-contract";
import { MarketplaceError } from "../../../src/marketplace/error";
import { harnessTraceDocumentSchema } from "../../../src/trajectory/adapters/contract";

const selector = fullSelectorSchema.parse(`s-${"a".repeat(64)}`);
const timestamp = "2026-07-24T12:34:56.000Z";

const validated = (events: readonly object[], runtime = "codex"): ValidatedTrace => ({
  frozenTrace: {
    selector,
    relativePath: "traces/adversarial.atf.json",
    hash: traceHashSchema.parse("b".repeat(64)),
    byteCount: 2,
    runtime,
    eventCount: events.length,
    earliestTimestamp: events.length === 0 ? "unknown" : timestamp,
    bytes: new Uint8Array([123, 125]),
  },
  document: harnessTraceDocumentSchema.parse({
    runtime,
    status: "collected",
    formatVersion: 2,
    eventCount: events.length,
    events,
  }),
});

const attested = (event: object, index: number): object => ({
  ...event,
  timestamp: new Date(Date.parse(timestamp) + index * 1_000).toISOString(),
  sourceEventId: `event-${index}`,
});

const dangerousCodePoint = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

const deeplyNestedValue = (depth: number): unknown => {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
};

const marketplaceErrorCode = (run: () => unknown): string | undefined => {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof MarketplaceError ? error.code : undefined;
  }
};

describe("bounded session reports", () => {
  test("rejects excessively deep payloads as invalid_trace", () => {
    // Given: schema-valid payload values at the traversal boundary plus pathological input/output graphs.
    const accepted = validated([
      attested({ kind: "tool_call", name: "terminal", payload: { input: deeplyNestedValue(256) } }, 0),
    ]);
    const tooDeepInput = validated([
      attested({ kind: "tool_call", name: "terminal", payload: { input: deeplyNestedValue(257) } }, 0),
    ]);
    const veryDeepInput = validated([
      attested({ kind: "tool_call", name: "terminal", payload: { input: deeplyNestedValue(100_000) } }, 0),
    ]);
    const tooDeepOutput = validated([
      attested({ kind: "tool_result", name: "terminal", payload: { output: deeplyNestedValue(100_000) } }, 0),
    ]);
    const cyclicInput: { nested?: unknown } = {};
    cyclicInput.nested = cyclicInput;
    const cyclicOutput: unknown[] = [];
    cyclicOutput.push(cyclicOutput);
    const cyclicInputTrace = validated([
      attested({ kind: "tool_call", name: "terminal", payload: { input: cyclicInput } }, 0),
    ]);
    const cyclicOutputTrace = validated([
      attested({ kind: "tool_result", name: "terminal", payload: { output: cyclicOutput } }, 0),
    ]);

    // When: list and inspection evidence cross the sanitizer boundary.
    const acceptedReport = buildSessionReport(accepted);
    const rejected = [
      marketplaceErrorCode(() => buildSessionListItem(tooDeepInput)),
      marketplaceErrorCode(() => buildSessionReport(veryDeepInput)),
      marketplaceErrorCode(() => buildSessionReport(tooDeepOutput)),
      marketplaceErrorCode(() => buildSessionListItem(cyclicInputTrace)),
      marketplaceErrorCode(() => buildSessionReport(cyclicOutputTrace)),
    ];

    // Then: depth 256 remains visible, while every rejected graph has the stable marketplace error.
    expect(acceptedReport.items).toHaveLength(1);
    expect(rejected).toEqual(["invalid_trace", "invalid_trace", "invalid_trace", "invalid_trace", "invalid_trace"]);
  });

  test("preserves actual source indices and categorizes request action result and error evidence", () => {
    // Given: a current-schema trace with stored user, tool, assistant, and failing tool-result events.
    const trace = validated([
      attested({ kind: "session_start", name: "session" }, 0),
      attested({ kind: "function_enter", name: "turn-1", payload: { role: "user", content: "review this" } }, 1),
      attested({ kind: "tool_call", name: "terminal", payload: { input: { command: "bun test" } } }, 2),
      attested({ kind: "llm_call", name: "model", payload: { role: "assistant", content: "I ran it." } }, 3),
      attested({ kind: "tool_result", name: "terminal", payload: { output: "exit 1", isError: true } }, 4),
    ]);

    // When: bounded inspection evidence is derived from the validated trace.
    const report = buildSessionReport(trace);
    const listed = buildSessionListItem(trace);

    // Then: every category points to its real zero-based source event rather than an inferred summary.
    expect(report.items.map((item) => [item.kind, item.eventIndex])).toEqual([
      ["request", 1], ["action", 2], ["result", 3], ["error", 4],
    ]);
    expect(report.items[1]?.text).toContain("terminal");
    expect(listed.firstRequestExcerpt).toBe("review this");
    expect(listed.firstExcerpt).toBe("review this");
    expect(listed.earliestTimestamp).toBe(timestamp);
  });

  test("falls back to the first result excerpt when a session has no user request event", () => {
    // Given: a session whose earliest content is an assistant result, like exported codex rollouts.
    const trace = validated([
      attested({ kind: "session_start", name: "session" }, 0),
      attested({ kind: "llm_call", name: "model", payload: { role: "assistant", content: "TYPE B implementation research summary" } }, 1),
      attested({ kind: "tool_call", name: "terminal", payload: { input: { command: "ls" } } }, 2),
    ]);

    // When: the compact list item is derived.
    const listed = buildSessionListItem(trace);

    // Then: the agent still gets a content hint, while the strict request field stays honest.
    expect(listed.firstRequestExcerpt).toBeUndefined();
    expect(listed.firstExcerpt).toBe("TYPE B implementation research summary");
  });

  test("reports stored redaction truncation unknown events and terminal sanitization without raw controls", () => {
    // Given: representative runtime payloads containing collection markers and hostile terminal controls.
    const trace = validated([
      attested({ kind: "function_enter", name: "turn-1", payload: { role: "user", content: "[redacted] \u001b]8;;https://attacker.invalid\u0007click\u001b]8;;\u0007\u202E" } }, 0),
      attested({ kind: "tool_call", name: "terminal", payload: { input: { truncated: true } } }, 1),
      attested({ kind: "llm_call", name: "unknown", payload: { role: "assistant", content: `tail…[truncated]\u009b31m` } }, 2),
      attested({ kind: "future_event", name: "future", payload: { output: "ignored" } }, 3),
    ], "openclaw");

    // When: safe structured and human forms are created from the same stored event values.
    const report = buildSessionReport(trace);
    const human = renderSessionReport(report);
    const serialized = JSON.stringify(report);

    // Then: marker states remain explicit and no terminal-control code point survives either output surface.
    expect(report.markers.map((marker) => marker.kind)).toEqual([
      "redacted", "sanitized", "truncated", "truncated", "sanitized", "unknown_event_kind", "unknown_event_kind",
    ]);
    expect(report.markers.map((marker) => marker.eventIndex)).toEqual([0, 0, 1, 2, 2, 2, 3]);
    expect(serialized).toContain("[control:U+001B]");
    expect(serialized).toContain("[bidi:U+202E]");
    expect(dangerousCodePoint.test(serialized)).toBe(false);
    expect(dangerousCodePoint.test(human.replaceAll("\n", ""))).toBe(false);
  });

  test("redacts inline and nested credential values from list and inspection evidence", () => {
    // Given: a schema-valid direct ATF whose strings and sensitive object keys bypassed native redaction.
    const inlineSecrets = ["h7", "q9", "v5", "z2", "y4", "x6", "w8"] as const;
    const nestedSecret = "n3";
    const trace = validated([
      attested({
        kind: "function_enter",
        name: "turn-1",
        payload: {
          role: "user",
          content: `review password=${inlineSecrets[0]} TOKEN="${inlineSecrets[1]}" client-secret:${inlineSecrets[2]} auth ${inlineSecrets[3]} API-key '${inlineSecrets[4]}' token ${inlineSecrets[5]} Bearer ${inlineSecrets[6]}`,
        },
      }, 0),
      attested({ kind: "tool_call", name: "terminal", payload: { input: { password: nestedSecret } } }, 1),
      attested({ kind: "tool_result", name: "terminal", payload: { output: { token: nestedSecret } } }, 2),
    ]);

    // When: both user-facing session summaries are produced.
    const report = buildSessionReport(trace);
    const rendered = `${renderSessionList([buildSessionListItem(trace)])}\n${renderSessionReport(report)}`;

    // Then: the secret never crosses the output boundary and redaction stays visible.
    for (const secret of inlineSecrets) expect(JSON.stringify({ report, rendered })).not.toContain(secret);
    expect(JSON.stringify({ report, rendered })).not.toContain(nestedSecret);
    expect(rendered).toContain("review [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted]");
    expect(report.items[1]?.text).toContain('{"password":"[redacted]"}');
    expect(report.items[2]?.text).toContain('{"token":"[redacted]"}');
    expect(report.markers.filter((marker) => marker.kind === "redacted")).toHaveLength(3);
  });

  test("bounds Unicode-safe excerpts and declares evidence omitted after the two-hundredth item", () => {
    // Given: 201 actual user events, with the first ending immediately after a surrogate-pair boundary.
    const veryLongRequest = `${"x".repeat(999)}😀more`;
    const events = Array.from({ length: 201 }, (_, index) => attested({
      kind: "function_enter",
      name: `turn-${index}`,
      payload: { role: "user", content: index === 0 ? veryLongRequest : `request-${index}` },
    }, index));

    // When: report generation applies the fixed text and evidence limits.
    const report = buildSessionReport(validated(events));

    // Then: the boundary is valid Unicode and the unrendered source item is declared explicitly.
    expect(report.items).toHaveLength(200);
    expect(report.omittedItemCount).toBe(1);
    expect(Array.from(report.items[0]?.text ?? "")).toHaveLength(1_000);
    expect(report.items[0]?.text).toEndWith("…[truncated]");
  });

  test("renders inspection structure as separate logical lines without splitting CJK evidence", () => {
    // Given: a safe inspection report whose CJK request and terminal marker must remain intact.
    const report = {
      selector,
      runtime: "openclaw",
      items: [
        { kind: "request", eventIndex: 7, timestamp, text: "안녕하세요!", markers: [] },
        { kind: "error", eventIndex: 8, text: "실행 \u001b[31m완료", markers: [] },
      ],
      omittedItemCount: 1,
      markers: [{ kind: "sanitized", eventIndex: 8 }],
    } satisfies SessionReport;

    // When: the human inspection renderer formats its bounded report.
    const human = renderSessionReport(report);

    // Then: every structural record occupies one logical line and no unsafe control survives.
    expect(human.split("\n")).toEqual([
      `selector: ${selector}`,
      "runtime: openclaw",
      `[7] ${timestamp} request: 안녕하세요!`,
      "[8] unknown error: 실행 [control:U+001B][31m완료",
      "omitted: 1",
      "markers: sanitized@8",
    ]);
    expect(human).not.toContain(" | ");
    expect(dangerousCodePoint.test(human.replaceAll("\n", ""))).toBe(false);
  });

  test("renders each session list record as logical lines without splitting CJK requests", () => {
    // Given: two safe list records with full opaque selectors, a Korean request, and stored sanitization markers.
    const secondSelector = fullSelectorSchema.parse(`s-${"c".repeat(64)}`);
    const listed = [
      {
        selector,
        runtime: "openclaw",
        earliestTimestamp: timestamp,
        eventCount: 7,
        byteCount: 512,
        firstRequestExcerpt: "현재 디렉토리의 파일 목록 알려줘",
        markers: [{ kind: "sanitized", eventIndex: 1 }],
      },
      {
        selector: secondSelector,
        runtime: "codex",
        earliestTimestamp: "unknown" as const,
        eventCount: 0,
        byteCount: 0,
        firstRequestExcerpt: "[redacted] \u001b[31m",
        markers: [{ kind: "redacted", eventIndex: 0 }, { kind: "sanitized", eventIndex: 0 }],
      },
    ] satisfies SessionList;

    // When: the human list renderer formats the stored session records.
    const human = renderSessionList(listed);

    // Then: fields stay complete on logical lines and sessions have an explicit blank-line boundary.
    expect(human.split("\n")).toEqual([
      `selector: ${selector}`,
      "runtime: openclaw",
      `earliest: ${timestamp}`,
      "events: 7",
      "bytes: 512",
      "excerpt: 현재 디렉토리의 파일 목록 알려줘",
      "markers: sanitized@1",
      "",
      `selector: ${secondSelector}`,
      "runtime: codex",
      "earliest: unknown",
      "events: 0",
      "bytes: 0",
      "excerpt: [redacted] [control:U+001B][31m",
      "markers: redacted@0, sanitized@0",
    ]);
    expect(human).not.toContain(" | ");
    expect(dangerousCodePoint.test(human.replaceAll("\n", ""))).toBe(false);
  });
});
