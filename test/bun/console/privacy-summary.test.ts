import { describe, expect, test } from "bun:test";

import { summarizePrivacyFiltering } from "@/console/privacy-summary";
import type { PrivacyRuleFamily } from "@/console/contract";
import { harnessTraceDocumentSchema } from "@/trajectory/adapters/contract";
import { fullSelectorSchema, traceHashSchema } from "@/marketplace/session-contract";
import type { ValidatedTrace } from "@/marketplace/session-contract";

const selector = fullSelectorSchema.parse(`s-${"a".repeat(64)}`);
const hash = traceHashSchema.parse("b".repeat(64));

const validatedTrace = (events: readonly unknown[]): ValidatedTrace => {
  const document = harnessTraceDocumentSchema.parse({
    runtime: "claude-code",
    status: "collected",
    formatVersion: 2,
    eventCount: events.length,
    events,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  return {
    document,
    frozenTrace: {
      selector,
      relativePath: "traces/one.atf.json",
      hash,
      byteCount: bytes.byteLength,
      runtime: document.runtime,
      eventCount: document.eventCount,
      earliestTimestamp: "unknown",
      bytes,
    },
  };
};

const familiesOf = (counts: readonly { family: PrivacyRuleFamily; count: number }[]): readonly string[] =>
  counts.map((entry) => entry.family);

const countFor = (
  counts: readonly { family: PrivacyRuleFamily; count: number }[],
  family: PrivacyRuleFamily,
): number => counts.find((entry) => entry.family === family)?.count ?? 0;

describe("summarizePrivacyFiltering", () => {
  test("attributes a redacted value under a sensitive key to the sensitive_key family", () => {
    const trace = validatedTrace([
      {
        kind: "tool_call",
        name: "http_request",
        payload: { input: { api_key: "[redacted]", url: "https://example.com" } },
      },
    ]);

    const summary = summarizePrivacyFiltering(trace);

    expect(countFor(summary.ruleCounts, "sensitive_key")).toBe(1);
    expect(countFor(summary.ruleCounts, "credential_pattern")).toBe(0);
    const finding = summary.findings.find((entry) => entry.family === "sensitive_key");
    expect(finding?.keyName).toBe("api_key");
    expect(finding?.path).toBe("input.api_key");
    expect(finding?.eventIndex).toBe(0);
  });

  test("attributes a redacted span inside free text to the credential_pattern family", () => {
    const trace = validatedTrace([
      {
        kind: "function_enter",
        name: "user",
        payload: { role: "user", content: "deploy with [redacted] then restart" },
      },
    ]);

    const summary = summarizePrivacyFiltering(trace);

    expect(countFor(summary.ruleCounts, "credential_pattern")).toBe(1);
    expect(countFor(summary.ruleCounts, "sensitive_key")).toBe(0);
    expect(summary.findings[0]?.path).toBe("content");
  });

  test("counts truncation markers as oversized_value and control markers as terminal_control", () => {
    const trace = validatedTrace([
      {
        kind: "tool_result",
        name: "read_file",
        payload: { output: "long body…[truncated]" },
      },
      {
        kind: "tool_result",
        name: "read_file",
        payload: { output: "line[control:U+0007]end" },
      },
    ]);

    const summary = summarizePrivacyFiltering(trace);

    expect(countFor(summary.ruleCounts, "oversized_value")).toBe(1);
    expect(countFor(summary.ruleCounts, "terminal_control")).toBe(1);
    expect(summary.findings.map((entry) => entry.eventIndex)).toEqual([0, 1]);
  });

  test("reports zero counts and no findings for a trace that needed no filtering", () => {
    const trace = validatedTrace([
      { kind: "tool_call", name: "list_dir", payload: { input: { path: "src" } } },
    ]);

    const summary = summarizePrivacyFiltering(trace);

    expect(summary.findings).toEqual([]);
    expect(familiesOf(summary.ruleCounts)).toEqual([]);
    expect(summary.eventCount).toBe(1);
    expect(summary.selector).toBe(selector);
    expect(summary.runtime).toBe("claude-code");
  });

  test("caps findings and reports how many were omitted", () => {
    const events = Array.from({ length: 260 }, () => ({
      kind: "tool_call",
      name: "http_request",
      payload: { input: { token: "[redacted]" } },
    }));

    const summary = summarizePrivacyFiltering(validatedTrace(events));

    expect(summary.findings.length).toBe(200);
    expect(summary.omittedFindingCount).toBe(60);
    expect(countFor(summary.ruleCounts, "sensitive_key")).toBe(260);
  });

  test("windows stored text around the marker so the finding stays visible", () => {
    const trace = validatedTrace([
      {
        kind: "function_enter",
        name: "user",
        payload: { role: "user", content: `${"x".repeat(4_000)} [redacted] ${"y".repeat(4_000)}` },
      },
    ]);

    const summary = summarizePrivacyFiltering(trace);

    expect(summary.findings).toHaveLength(1);
    for (const finding of summary.findings) {
      expect(Array.from(finding.storedText).length).toBeLessThanOrEqual(320);
      expect(finding.storedText).toContain("[redacted]");
    }
  });
});
