import { describe, expect, test } from "bun:test";

import { buildConsoleOverview, buildEgressPreview } from "@/console/overview";
import { fullSelectorSchema } from "@/marketplace/session-contract";
import type { SessionListItem } from "@/marketplace/session-contract";

const selectorAt = (index: number) =>
  fullSelectorSchema.parse(`s-${String(index).padStart(64, "0")}`);

const item = (
  index: number,
  overrides: Partial<Omit<SessionListItem, "selector">> = {},
): SessionListItem => ({
  selector: selectorAt(index),
  runtime: "claude-code",
  earliestTimestamp: "2026-07-27T10:00:00Z",
  eventCount: 10,
  byteCount: 1_000,
  markers: [],
  ...overrides,
});

describe("buildConsoleOverview", () => {
  test("totals sessions, events, and bytes across the snapshot", () => {
    const overview = buildConsoleOverview([
      item(1, { eventCount: 4, byteCount: 100 }),
      item(2, { eventCount: 6, byteCount: 250 }),
    ]);

    expect(overview.sessionCount).toBe(2);
    expect(overview.eventCount).toBe(10);
    expect(overview.byteCount).toBe(350);
  });

  test("counts a session as redacted only when it carries a redacted marker", () => {
    const overview = buildConsoleOverview([
      item(1, { markers: [{ kind: "redacted", eventIndex: 0 }] }),
      item(2, { markers: [{ kind: "truncated", eventIndex: 1 }] }),
      item(3),
    ]);

    expect(overview.redactedSessionCount).toBe(1);
  });

  test("groups days newest first using the earliest timestamp date", () => {
    const overview = buildConsoleOverview([
      item(1, { earliestTimestamp: "2026-07-25T23:30:00Z", eventCount: 1, byteCount: 10 }),
      item(2, { earliestTimestamp: "2026-07-27T01:00:00Z", eventCount: 2, byteCount: 20 }),
      item(3, { earliestTimestamp: "2026-07-27T09:00:00Z", eventCount: 3, byteCount: 30 }),
    ]);

    expect(overview.days.map((row) => row.day)).toEqual(["2026-07-27", "2026-07-25"]);
    expect(overview.days[0]?.sessionCount).toBe(2);
    expect(overview.days[0]?.eventCount).toBe(5);
    expect(overview.days[0]?.byteCount).toBe(50);
  });

  test("excludes undated sessions from day rows and reports them separately", () => {
    const overview = buildConsoleOverview([
      item(1, { earliestTimestamp: "unknown" }),
      item(2, { earliestTimestamp: "2026-07-27T01:00:00Z" }),
    ]);

    expect(overview.undatedSessionCount).toBe(1);
    expect(overview.days).toHaveLength(1);
  });

  test("ranks runtime counts by session volume then name", () => {
    const overview = buildConsoleOverview([
      item(1, { runtime: "codex" }),
      item(2, { runtime: "claude-code" }),
      item(3, { runtime: "claude-code" }),
    ]);

    expect(overview.runtimeCounts).toEqual([
      { runtime: "claude-code", count: 2 },
      { runtime: "codex", count: 1 },
    ]);
  });

  test("returns an empty overview for an empty snapshot", () => {
    const overview = buildConsoleOverview([]);

    expect(overview).toEqual({
      sessionCount: 0,
      eventCount: 0,
      byteCount: 0,
      redactedSessionCount: 0,
      runtimeCounts: [],
      days: [],
      undatedSessionCount: 0,
    });
  });
});

describe("buildEgressPreview", () => {
  test("counts only selected sessions and sums what would leave the machine", () => {
    const items = [
      item(1, { eventCount: 4, byteCount: 100 }),
      item(2, { eventCount: 6, byteCount: 250 }),
      item(3, { eventCount: 9, byteCount: 900 }),
    ];

    const preview = buildEgressPreview(items, [selectorAt(1), selectorAt(3)], [
      { family: "sensitive_key", count: 2 },
    ]);

    expect(preview.selectedCount).toBe(2);
    expect(preview.availableCount).toBe(3);
    expect(preview.eventCount).toBe(13);
    expect(preview.byteCount).toBe(1_000);
    expect(preview.selectors).toEqual([selectorAt(1), selectorAt(3)]);
    expect(preview.ruleCounts).toEqual([{ family: "sensitive_key", count: 2 }]);
  });

  test("ignores selectors that are not present in the snapshot", () => {
    const preview = buildEgressPreview([item(1)], [selectorAt(1), selectorAt(99)], []);

    expect(preview.selectedCount).toBe(1);
    expect(preview.selectors).toEqual([selectorAt(1)]);
  });

  test("reports an empty egress when nothing is selected", () => {
    const preview = buildEgressPreview([item(1), item(2)], [], []);

    expect(preview.selectedCount).toBe(0);
    expect(preview.byteCount).toBe(0);
    expect(preview.eventCount).toBe(0);
    expect(preview.availableCount).toBe(2);
  });
});
