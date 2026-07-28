import { describe, expect, test } from "bun:test";

import { findingWindow } from "@/console/excerpt";

describe("findingWindow", () => {
  test("keeps the marker visible with context on both sides", () => {
    const text = `${"a".repeat(400)}[redacted]${"b".repeat(400)}`;

    const window = findingWindow(text, "[redacted]");

    expect(window).toContain("[redacted]");
    expect(Array.from(window).length).toBeLessThanOrEqual(320);
    expect(window.startsWith("…")).toBe(true);
    expect(window.endsWith("…")).toBe(true);
  });

  test("returns short text unchanged without ellipsis", () => {
    expect(findingWindow("token was [redacted] here", "[redacted]")).toBe(
      "token was [redacted] here",
    );
  });

  test("keeps the head when the marker sits at the start", () => {
    const window = findingWindow(`[redacted]${"b".repeat(400)}`, "[redacted]");

    expect(window.startsWith("[redacted]")).toBe(true);
    expect(window.endsWith("…")).toBe(true);
  });

  test("falls back to the head of the text when the marker is absent", () => {
    const window = findingWindow("c".repeat(400), "[redacted]");

    expect(window.startsWith("ccc")).toBe(true);
    expect(Array.from(window).length).toBeLessThanOrEqual(320);
  });

  test("windows around a truncation marker as well", () => {
    const text = `${"a".repeat(400)}…[truncated]`;

    const window = findingWindow(text, "…[truncated]");

    expect(window).toContain("…[truncated]");
    expect(Array.from(window).length).toBeLessThanOrEqual(320);
  });
});
