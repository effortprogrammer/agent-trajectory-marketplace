import { expect, test } from "bun:test";

import { sanitizeHarnessPayload } from "../../../src/trajectory/adapters/contract";
import {
  boundedRedactedString,
  isPayloadStructureBounded,
} from "../../../src/trajectory/adapters/payload-sanitizer";

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

test("payload bounds reject an enumerable accessor without invoking it", () => {
  // Given: a within-budget object whose enumerable accessor must not execute.
  let getterReads = 0;
  const input = {};
  Object.defineProperty(input, "value", {
    enumerable: true,
    get: (): string => {
      getterReads += 1;
      throw new RangeError("accessor was invoked");
    },
  });

  // When: the untrusted structure is checked.
  const bounded = isPayloadStructureBounded(input);

  // Then: accessor-backed payloads fail closed without running user code.
  expect(bounded).toBe(false);
  expect(getterReads).toBe(0);
});

test("payload sanitization rejects an enumerable accessor without invoking it", () => {
  // Given: the same hostile accessor at the sanitizer boundary.
  let getterReads = 0;
  const input = {};
  Object.defineProperty(input, "value", {
    enumerable: true,
    get: (): string => {
      getterReads += 1;
      throw new RangeError("accessor was invoked");
    },
  });

  // When: the payload is sanitized.
  const sanitized = sanitizeHarnessPayload({ input });

  // Then: it is rejected without invoking the getter.
  expect(sanitized).toBeUndefined();
  expect(getterReads).toBe(0);
});

test("truncation never exceeds a byte cap smaller than its marker", () => {
  // Given: a multibyte value and a cap too small for the full truncation marker.
  const byteCap = 1;

  // When: the raw payload string helper truncates it.
  const result = boundedRedactedString("한", byteCap);

  // Then: its output still honors the caller's byte contract.
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(byteCap);
});
