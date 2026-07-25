const maxPayloadDepth = 256;
const maxVisitedValues = 65_536;

const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
  /\b(?:authorization|api[_-]?key|secret|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}={0,2}/gi,
  /\b(?:sk-|gh[pousr]_)[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
] as const;
const sensitiveKeyMarkers = new Set([
  "password", "passwd", "pass", "auth", "authorization", "token", "key", "secret",
]);
const sensitiveKeyCompounds = new Set([
  "apikey", "accesstoken", "refreshtoken", "authtoken", "clientsecret", "privatekey", "bearer",
]);

type SanitizerState = {
  truncated: boolean;
  visitedValues: number;
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

export type SanitizedPayloadValue = Readonly<{ value: unknown; truncated: boolean }>;

const redactCredentialSpans = (value: string): string => {
  let redacted = value;
  for (const pattern of credentialPatterns) redacted = redacted.replace(pattern, "[redacted]");
  return redacted;
};

const isSensitiveObjectKey = (key: string): boolean => {
  const normalized = key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
  return (
    normalized.split("_").some((part) => sensitiveKeyMarkers.has(part)) ||
    sensitiveKeyCompounds.has(normalized.replaceAll("_", ""))
  );
};

const arrayIndexes = (value: readonly unknown[]): readonly number[] =>
  Object.keys(value).flatMap((key) => {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < value.length && String(index) === key
      ? [index]
      : [];
  });

export const boundedRedactedString = (
  value: string,
  maxStringBytes: number,
): Readonly<{ text: string; truncated: boolean }> => {
  const redacted = redactCredentialSpans(value);
  if (Buffer.byteLength(redacted, "utf8") <= maxStringBytes) {
    return { text: redacted, truncated: false };
  }
  const marker = "…[truncated]";
  const buffer = Buffer.from(redacted, "utf8");
  let end = maxStringBytes - Buffer.byteLength(marker, "utf8");
  while (end > 0 && (buffer[end] ?? 0) >> 6 === 0b10) end -= 1;
  return { text: `${buffer.subarray(0, end).toString("utf8")}${marker}`, truncated: true };
};

export const sanitizePayloadValue = (
  input: unknown,
  maxStringBytes: number,
): SanitizedPayloadValue | undefined => {
  let result: unknown;
  const state: SanitizerState = {
    truncated: false,
    visitedValues: 0,
    ancestors: new Set<object>(),
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
    if (typeof frame.value === "string") {
      if (frame.sensitiveContext) {
        frame.assign("[redacted]");
        continue;
      }
      const bounded = boundedRedactedString(frame.value, maxStringBytes);
      if (bounded.truncated) state.truncated = true;
      frame.assign(bounded.text);
      continue;
    }
    if (frame.value === null || typeof frame.value !== "object") {
      frame.assign(frame.value);
      continue;
    }
    if (state.ancestors.has(frame.value)) return undefined;
    state.ancestors.add(frame.value);
    stack.push({ kind: "exit", value: frame.value });
    if (Array.isArray(frame.value)) {
      if (state.visitedValues + frame.value.length > maxVisitedValues) return undefined;
      const indexes = arrayIndexes(frame.value);
      const output = new Array<unknown>(frame.value.length);
      frame.assign(output);
      for (let position = indexes.length - 1; position >= 0; position -= 1) {
        const index = indexes[position];
        if (index === undefined) continue;
        stack.push({
          kind: "enter",
          value: frame.value[index],
          sensitiveContext: frame.sensitiveContext,
          depth: frame.depth + 1,
          assign: (value) => {
            output[index] = value;
          },
        });
      }
      continue;
    }
    const entries = Object.entries(frame.value);
    if (state.visitedValues + entries.length > maxVisitedValues) return undefined;
    const output: Record<string, unknown> = {};
    frame.assign(output);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      const [key, value] = entry;
      stack.push({
        kind: "enter",
        value,
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
  return { value: result, truncated: state.truncated };
};
