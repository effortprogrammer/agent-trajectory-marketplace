import { describe, expect, test } from "bun:test";

import { sessionRowExcerpt } from "@/console/excerpt";

describe("sessionRowExcerpt", () => {
  test("collapses control markers and whitespace into single spaces", () => {
    const excerpt = sessionRowExcerpt(
      "first line[control:U+000A][control:U+000A]second   line\tthird",
    );

    expect(excerpt).toBe("first line second line third");
  });

  test("caps the excerpt so a table row stays a single line", () => {
    const excerpt = sessionRowExcerpt("x".repeat(400));

    expect(Array.from(excerpt).length).toBeLessThanOrEqual(120);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  test("keeps a short excerpt untouched and adds no ellipsis", () => {
    expect(sessionRowExcerpt("fix the flaky test")).toBe("fix the flaky test");
  });

  test("breaks the cap on a word boundary when one is close to the limit", () => {
    const excerpt = sessionRowExcerpt(`${"alpha ".repeat(30)}omega`);

    expect(excerpt.endsWith(" …")).toBe(false);
    expect(excerpt).not.toContain("  ");
    expect(Array.from(excerpt).length).toBeLessThanOrEqual(120);
  });

  test("returns a placeholder when there is no request text", () => {
    expect(sessionRowExcerpt(undefined)).toBe("(no request recorded)");
    expect(sessionRowExcerpt("   ")).toBe("(no request recorded)");
  });

  test("keeps redaction and truncation markers visible in the excerpt", () => {
    expect(sessionRowExcerpt("token was [redacted] here")).toContain("[redacted]");
  });
});
