import { expect, test } from "bun:test";

import { sanitizeHarnessPayload } from "../../../src/trajectory/adapters/contract";
import { isPayloadStructureBounded } from "../../../src/trajectory/adapters/payload-sanitizer";

const overBudgetObject = (): Readonly<Record<string, unknown>> => {
  const value: Record<string, unknown> = {};
  for (let index = 0; index < 65_536; index += 1) {
    Object.defineProperty(value, `key-${index}`, {
      enumerable: true,
      get: (): string => {
        if (index === 65_535) throw new RangeError("over-budget value was read");
        return "value";
      },
    });
  }
  return value;
};

test("payload bounds reject a wide object before reading its values", () => {
  // Given: an object whose final value must never be read after its key count exceeds the budget.
  const input = overBudgetObject();

  // When: the marketplace ingestion bound checks the untrusted payload graph.
  const bounded = isPayloadStructureBounded({ input });

  // Then: the object is rejected without materializing or reading all values.
  expect(bounded).toBe(false);
});

test("payload sanitization rejects a wide object before reading its values", () => {
  // Given: the same over-budget object at the collection-time sanitizer boundary.
  const input = overBudgetObject();

  // When: the payload is sanitized.
  const sanitized = sanitizeHarnessPayload({ input });

  // Then: the object is rejected without invoking the terminal getter.
  expect(sanitized).toBeUndefined();
});
