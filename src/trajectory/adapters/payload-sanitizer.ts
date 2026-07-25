import { boundedRedactedString, isSensitiveObjectKey } from "./payload-redaction";

export { boundedRedactedString } from "./payload-redaction";

const maxPayloadDepth = 256;
const maxVisitedValues = 65_536;

type SanitizerState = {
  truncated: boolean;
  visitedValues: number;
  serializedBytes: number;
  readonly ancestors: Set<object>;
};

type SanitizerFrame =
  | Readonly<{
      kind: "enter";
      value: unknown;
      sensitiveContext: boolean;
      depth: number;
      assign: (value: unknown) => void;
    }>
  | Readonly<{ kind: "exit"; value: object }>;

type BoundsFrame =
  | Readonly<{ kind: "enter"; value: unknown; depth: number }>
  | Readonly<{ kind: "exit"; value: object }>;

type ArrayShape = Readonly<{
  indexes: readonly number[];
  length: number;
}>;

export type SanitizedPayloadValue = Readonly<{
  value: unknown;
  truncated: boolean;
  serializedLimitExceeded: boolean;
}>;

const serializedLimitResult: SanitizedPayloadValue = {
  value: undefined, truncated: true, serializedLimitExceeded: true,
};

const failClosedReflect = <Value>(operation: () => Value): Value | undefined => {
  try {
    return operation();
  } catch {
    return undefined;
  }
};

const asArray = (value: object): readonly unknown[] | false | undefined =>
  failClosedReflect(() => Array.isArray(value) ? value : false);

const arrayShape = (value: readonly unknown[]): ArrayShape | undefined =>
  failClosedReflect(() => {
    const length = value.length;
    const indexes = Object.keys(value).flatMap((key) => {
      const index = Number(key);
      return Number.isInteger(index) && index >= 0 && index < length && String(index) === key
        ? [index]
        : [];
    });
    return { indexes, length };
  });

const boundedEnumerableKeys = (value: object, maximum: number): readonly string[] | undefined =>
  failClosedReflect(() => {
    const keys: string[] = [];
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      keys.push(key);
      if (keys.length > maximum) return undefined;
    }
    return keys;
  });

const ownEnumerableDataValue = (value: object, key: string): Readonly<{ value: unknown }> | undefined =>
  failClosedReflect(() => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) return undefined;
    return { value: descriptor.value };
  });

export const isPayloadStructureBounded = (input: unknown): boolean => {
  let visitedValues = 0;
  const ancestors = new Set<object>();
  const stack: BoundsFrame[] = [{ kind: "enter", value: input, depth: -1 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }
    if (frame.depth >= 0) visitedValues += 1;
    if (visitedValues > maxVisitedValues || frame.depth > maxPayloadDepth) return false;
    if (frame.value === null || typeof frame.value !== "object") continue;
    const value = frame.value;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    stack.push({ kind: "exit", value });
    const array = asArray(value);
    if (array === undefined) return false;
    if (array !== false) {
      const shape = arrayShape(array);
      if (shape === undefined || visitedValues + shape.length > maxVisitedValues) return false;
      for (let index = shape.indexes.length - 1; index >= 0; index -= 1) {
        const childIndex = shape.indexes[index];
        if (childIndex === undefined) continue;
        const child = ownEnumerableDataValue(array, childIndex.toString());
        if (child === undefined) return false;
        stack.push({ kind: "enter", value: child.value, depth: frame.depth + 1 });
      }
      continue;
    }
    const keys = boundedEnumerableKeys(value, maxVisitedValues - visitedValues);
    if (keys === undefined) return false;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      const child = ownEnumerableDataValue(value, key);
      if (child === undefined) return false;
      stack.push({ kind: "enter", value: child.value, depth: frame.depth + 1 });
    }
  }
  return true;
};

export const sanitizePayloadValue = (
  input: unknown,
  maxStringBytes: number,
  maxSerializedBytes: number,
): SanitizedPayloadValue | undefined => {
  let result: unknown;
  const state: SanitizerState = {
    truncated: false,
    visitedValues: 0,
    serializedBytes: 0,
    ancestors: new Set<object>(),
  };
  const consumeSerializedBytes = (bytes: number): boolean => {
    state.serializedBytes += bytes;
    return state.serializedBytes <= maxSerializedBytes;
  };
  const stack: SanitizerFrame[] = [
    {
      kind: "enter",
      value: input,
      sensitiveContext: false,
      depth: -1,
      assign: (value) => {
        result = value;
      },
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    if (frame.kind === "exit") {
      state.ancestors.delete(frame.value);
      continue;
    }
    if (frame.depth >= 0) state.visitedValues += 1;
    if (state.visitedValues > maxVisitedValues || frame.depth > maxPayloadDepth) {
      return undefined;
    }
    if (frame.sensitiveContext) {
      if (!consumeSerializedBytes(12)) return serializedLimitResult;
      frame.assign("[redacted]");
      continue;
    }
    if (typeof frame.value === "string") {
      const bounded = boundedRedactedString(frame.value, maxStringBytes);
      if (!consumeSerializedBytes(Buffer.byteLength(JSON.stringify(bounded.text), "utf8"))) {
        return serializedLimitResult;
      }
      if (bounded.truncated) state.truncated = true;
      frame.assign(bounded.text);
      continue;
    }
    if (frame.value === null || typeof frame.value !== "object") {
      if (typeof frame.value === "bigint") return undefined;
      const serialized = JSON.stringify(frame.value);
      if (!consumeSerializedBytes(serialized === undefined ? 4 : Buffer.byteLength(serialized, "utf8"))) {
        return serializedLimitResult;
      }
      frame.assign(frame.value);
      continue;
    }
    if (state.ancestors.has(frame.value)) return undefined;
    if (!consumeSerializedBytes(2)) return serializedLimitResult;
    state.ancestors.add(frame.value);
    stack.push({ kind: "exit", value: frame.value });
    const array = asArray(frame.value);
    if (array === undefined) return undefined;
    if (array !== false) {
      const shape = arrayShape(array);
      if (shape === undefined || state.visitedValues + shape.length > maxVisitedValues) return undefined;
      const arrayOverhead = Math.max(0, shape.length - 1) + (shape.length - shape.indexes.length) * 4;
      if (!consumeSerializedBytes(arrayOverhead)) return serializedLimitResult;
      const output = new Array<unknown>(shape.length);
      frame.assign(output);
      for (let position = shape.indexes.length - 1; position >= 0; position -= 1) {
        const index = shape.indexes[position];
        if (index === undefined) continue;
        const child = ownEnumerableDataValue(array, index.toString());
        if (child === undefined) return undefined;
        stack.push({
          kind: "enter",
          value: child.value,
          sensitiveContext: frame.sensitiveContext,
          depth: frame.depth + 1,
          assign: (value) => {
            output[index] = value;
          },
        });
      }
      continue;
    }
    const keys = boundedEnumerableKeys(frame.value, maxVisitedValues - state.visitedValues);
    if (keys === undefined) return undefined;
    const output: Record<string, unknown> = {};
    frame.assign(output);
    let serializedKeys = 0;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      const child = ownEnumerableDataValue(frame.value, key);
      if (child === undefined) return undefined;
      if (
        child.value === undefined ||
        typeof child.value === "function" ||
        typeof child.value === "symbol"
      ) continue;
      const rawKeyBytes = Buffer.byteLength(key, "utf8");
      if (!consumeSerializedBytes(rawKeyBytes)) return serializedLimitResult;
      const encodedKeyBytes = Buffer.byteLength(JSON.stringify(key), "utf8");
      if (!consumeSerializedBytes(encodedKeyBytes - rawKeyBytes + 1 + (serializedKeys > 0 ? 1 : 0))) {
        return serializedLimitResult;
      }
      serializedKeys += 1;
      stack.push({
        kind: "enter",
        value: child.value,
        sensitiveContext: frame.sensitiveContext || isSensitiveObjectKey(key),
        depth: frame.depth + 1,
        assign: (sanitized) => {
          Object.defineProperty(output, key, {
            configurable: true,
            enumerable: true,
            value: sanitized,
            writable: true,
          });
        },
      });
    }
  }
  return { value: result, truncated: state.truncated, serializedLimitExceeded: false };
};
