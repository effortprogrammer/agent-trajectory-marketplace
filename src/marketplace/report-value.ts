import { boundedRedactedString } from "../trajectory/adapters/contract";

export const maximumTextCharacters = 1_000;
export const truncationMarker = "…[truncated]";

const terminalControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const terminalControls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const reportCredential = /\b(?:Bearer\s+[^\s,;}\]]+|(?:auth(?:orization)?|api[_-]?key|secret|password|passwd|pass|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\b["']?(?:\s*[:=]\s*|\s+)(?!["']?\[redacted\]["']?)(?:"[^"\r\n]+"|'[^'\r\n]+'|Bearer\s+[^\s,;}\]]+|[^\s,;}\]]+))/gi;

export type SafeText = Readonly<{ text: string; sanitized: boolean; truncated: boolean }>;
type SafeData = Readonly<{ value: unknown; sanitized: boolean }>;

type DataFrame =
  | Readonly<{ kind: "enter"; value: unknown; assign: (value: unknown) => void }>
  | Readonly<{ kind: "exit"; value: object }>;
type ValueFrame =
  | Readonly<{ kind: "enter"; value: unknown }>
  | Readonly<{ kind: "exit"; value: object }>;

const controlMarker = (character: string): string => {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return "";
  const label = codePoint >= 0x202a && codePoint <= 0x202e || codePoint >= 0x2066 && codePoint <= 0x2069
    ? "bidi"
    : "control";
  return `[${label}:U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`;
};

export const safeText = (value: string): SafeText => {
  const redacted = boundedRedactedString(value).text.replace(reportCredential, "[redacted]");
  const sanitized = terminalControl.test(redacted);
  const terminalSafe = redacted.replace(terminalControls, controlMarker);
  const characters = Array.from(terminalSafe);
  if (characters.length <= maximumTextCharacters) {
    return { text: terminalSafe, sanitized, truncated: false };
  }
  const kept = characters.slice(0, maximumTextCharacters - Array.from(truncationMarker).length).join("");
  return { text: `${kept}${truncationMarker}`, sanitized, truncated: true };
};

const safeData = (input: unknown): SafeData | undefined => {
  let result: unknown;
  let sanitized = false;
  const ancestors = new Set<object>();
  const stack: DataFrame[] = [{ kind: "enter", value: input, assign: (value) => { result = value; } }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }
    if (typeof frame.value === "string") {
      const safe = safeText(frame.value);
      sanitized ||= safe.sanitized;
      frame.assign(safe.text);
      continue;
    }
    if (frame.value === null || typeof frame.value !== "object") {
      frame.assign(frame.value);
      continue;
    }
    if (ancestors.has(frame.value)) return undefined;
    ancestors.add(frame.value);
    stack.push({ kind: "exit", value: frame.value });
    if (Array.isArray(frame.value)) {
      const output = new Array<unknown>(frame.value.length);
      frame.assign(output);
      for (let index = frame.value.length - 1; index >= 0; index -= 1) {
        if (!(index in frame.value)) continue;
        stack.push({ kind: "enter", value: frame.value[index], assign: (value) => { output[index] = value; } });
      }
      continue;
    }
    const output: Record<string, unknown> = {};
    frame.assign(output);
    const entries = Object.entries(frame.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      const [key, value] = entry;
      const safeKey = safeText(key);
      sanitized ||= safeKey.sanitized;
      stack.push({
        kind: "enter",
        value,
        assign: (safeValue) => {
          Object.defineProperty(output, safeKey.text, {
            configurable: true,
            enumerable: true,
            value: safeValue,
            writable: true,
          });
        },
      });
    }
  }
  return { value: result, sanitized };
};

export const storedValue = (value: unknown): SafeText => {
  const sanitized = safeData(value);
  if (sanitized === undefined) return { text: "[invalid]", sanitized: true, truncated: false };
  const serialized = typeof sanitized.value === "string"
    ? sanitized.value
    : JSON.stringify(sanitized.value) ?? "undefined";
  const bounded = safeText(serialized);
  return { text: bounded.text, sanitized: sanitized.sanitized || bounded.sanitized, truncated: bounded.truncated };
};

const visitsReportValue = (
  input: unknown,
  onText: (text: string) => boolean,
  onEntry: (key: string, value: unknown) => boolean,
): boolean => {
  const ancestors = new Set<object>();
  const stack: ValueFrame[] = [{ kind: "enter", value: input }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }
    if (typeof frame.value === "string") {
      if (onText(frame.value)) return true;
      continue;
    }
    if (frame.value === null || typeof frame.value !== "object") continue;
    if (ancestors.has(frame.value)) continue;
    ancestors.add(frame.value);
    stack.push({ kind: "exit", value: frame.value });
    if (Array.isArray(frame.value)) {
      for (let index = frame.value.length - 1; index >= 0; index -= 1) {
        if (index in frame.value) stack.push({ kind: "enter", value: frame.value[index] });
      }
      continue;
    }
    const entries = Object.entries(frame.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      const [key, value] = entry;
      if (onEntry(key, value) || onText(key)) return true;
      stack.push({ kind: "enter", value });
    }
  }
  return false;
};

export const containsReportText = (value: unknown, predicate: (text: string) => boolean): boolean =>
  visitsReportValue(value, predicate, () => false);

export const containsTruncatedObject = (value: unknown): boolean =>
  visitsReportValue(value, () => false, (key, nested) => key === "truncated" && nested === true);
