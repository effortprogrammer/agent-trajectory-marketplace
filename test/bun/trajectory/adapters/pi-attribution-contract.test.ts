import { describe, expect, test } from "bun:test";

import { harnessTraceDocumentSchema } from "../../../../src/trajectory/adapters/contract";

const event = { kind: "function_enter", name: "turn-1" } as const;

describe("Pi runtime attribution contract", () => {
  test("requires operator-declared attribution for Pi traces", () => {
    const missing = harnessTraceDocumentSchema.safeParse({
      runtime: "pi",
      status: "collected",
      eventCount: 1,
      events: [event],
    });
    const declared = harnessTraceDocumentSchema.safeParse({
      runtime: "pi",
      runtimeAttribution: "operator_declared",
      status: "collected",
      eventCount: 1,
      events: [event],
    });

    expect(missing.success).toBe(false);
    expect(declared.success).toBe(true);
  });

  test("forbids Pi attribution metadata on sibling runtimes", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      runtime: "senpi",
      runtimeAttribution: "operator_declared",
      status: "collected",
      eventCount: 1,
      events: [event],
    });

    expect(result.success).toBe(false);
  });
});
