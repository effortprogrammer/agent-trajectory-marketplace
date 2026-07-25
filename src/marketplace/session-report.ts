import { boundedRedactedString, type HarnessTraceEvent } from "../trajectory/adapters/contract";
import type {
  SessionList,
  SessionListItem,
  SessionMarker,
  SessionReport,
  SessionWorkItem,
  ValidatedTrace,
} from "./session-contract";

const maximumEvidenceItems = 200;
const maximumTextCharacters = 1_000;
const truncationMarker = "…[truncated]";
const terminalControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const terminalControls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const reportTokenCredential = /\btoken\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}={0,2}/gi;
const knownEventKinds = new Set([
  "session_start", "function_enter", "function_exit", "llm_call", "tool_call", "tool_result",
]);

type SafeText = Readonly<{ text: string; sanitized: boolean; truncated: boolean }>;
type SafeData = Readonly<{ value: unknown; sanitized: boolean }>;

const controlMarker = (character: string): string => {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return "";
  const label = codePoint >= 0x202a && codePoint <= 0x202e || codePoint >= 0x2066 && codePoint <= 0x2069
    ? "bidi"
    : "control";
  return `[${label}:U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`;
};

const safeText = (value: string): SafeText => {
  const redacted = boundedRedactedString(value).text.replace(reportTokenCredential, "[redacted]");
  const sanitized = terminalControl.test(redacted);
  const terminalSafe = redacted.replace(terminalControls, controlMarker);
  const characters = Array.from(terminalSafe);
  if (characters.length <= maximumTextCharacters) {
    return { text: terminalSafe, sanitized, truncated: false };
  }
  const kept = characters.slice(0, maximumTextCharacters - Array.from(truncationMarker).length).join("");
  return { text: `${kept}${truncationMarker}`, sanitized, truncated: true };
};

const safeData = (value: unknown): SafeData => {
  if (typeof value === "string") {
    const safe = safeText(value);
    return { value: safe.text, sanitized: safe.sanitized };
  }
  if (Array.isArray(value)) {
    const entries = value.map(safeData);
    return { value: entries.map((entry) => entry.value), sanitized: entries.some((entry) => entry.sanitized) };
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, nested]) => {
      const safeKey = safeText(key);
      const safeValue = safeData(nested);
      return { key: safeKey.text, value: safeValue.value, sanitized: safeKey.sanitized || safeValue.sanitized };
    });
    return {
      value: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
      sanitized: entries.some((entry) => entry.sanitized),
    };
  }
  return { value, sanitized: false };
};

const storedValue = (value: unknown): SafeText => {
  const sanitized = safeData(value);
  const serialized = typeof sanitized.value === "string"
    ? sanitized.value
    : JSON.stringify(sanitized.value) ?? "undefined";
  const bounded = safeText(serialized);
  return { text: bounded.text, sanitized: sanitized.sanitized || bounded.sanitized, truncated: bounded.truncated };
};

const contains = (value: unknown, predicate: (text: string) => boolean): boolean => {
  if (typeof value === "string") return predicate(value);
  if (Array.isArray(value)) return value.some((item) => contains(item, predicate));
  if (value !== null && typeof value === "object") return Object.entries(value).some(
    ([key, nested]) => predicate(key) || contains(nested, predicate),
  );
  return false;
};

const containsTruncatedObject = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsTruncatedObject);
  if (value !== null && typeof value === "object") return Object.entries(value).some(
    ([key, nested]) => key === "truncated" && nested === true || containsTruncatedObject(nested),
  );
  return false;
};

const dedupeMarkers = (markers: readonly SessionMarker[]): readonly SessionMarker[] => {
  const seen = new Set<string>();
  return markers.filter((marker) => {
    const key = `${marker.kind}:${marker.eventIndex ?? "document"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const eventMarkers = (
  event: HarnessTraceEvent,
  eventIndex: number,
  fields: readonly SafeText[],
): readonly SessionMarker[] => {
  const payload = event.payload;
  const markers: SessionMarker[] = [];
  if (contains(payload, (text) => text.includes("[redacted]")) || fields.some((field) => field.text.includes("[redacted]"))) {
    markers.push({ kind: "redacted", eventIndex });
  }
  if (
    payload?.truncated === true || containsTruncatedObject(payload) ||
    contains(payload, (text) => text.includes(truncationMarker)) || fields.some((field) => field.truncated)
  ) {
    markers.push({ kind: "truncated", eventIndex });
  }
  if (fields.some((field) => field.sanitized)) markers.push({ kind: "sanitized", eventIndex });
  if (!knownEventKinds.has(event.kind) || event.name.toLowerCase() === "unknown") {
    markers.push({ kind: "unknown_event_kind", eventIndex });
  }
  return dedupeMarkers(markers);
};

const actionText = (event: HarnessTraceEvent): readonly [SafeText, readonly SafeText[]] => {
  const name = safeText(event.name);
  const input = event.payload?.input;
  if (input === undefined) return [name, [name]];
  const value = storedValue(input);
  const combined = safeText(`${name.text} ${value.text}`);
  return [combined, [name, value, combined]];
};

const resultText = (event: HarnessTraceEvent): readonly [SafeText, readonly SafeText[]] => {
  const name = safeText(event.name);
  const output = event.payload?.output;
  if (output === undefined) return [name, [name]];
  const value = storedValue(output);
  const combined = safeText(`${name.text} ${value.text}`);
  return [combined, [name, value, combined]];
};

const itemForEvent = (event: HarnessTraceEvent, eventIndex: number): SessionWorkItem | undefined => {
  const payload = event.payload;
  if (event.kind === "function_enter" && payload?.role === "user" && payload.content !== undefined) {
    const text = storedValue(payload.content);
    return { kind: "request", eventIndex, ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }), text: text.text, markers: eventMarkers(event, eventIndex, [text]) };
  }
  if (event.kind === "tool_call") {
    const [text, fields] = actionText(event);
    return { kind: "action", eventIndex, ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }), text: text.text, markers: eventMarkers(event, eventIndex, fields) };
  }
  if (event.kind === "llm_call" && payload?.role === "assistant" && payload.content !== undefined) {
    const text = storedValue(payload.content);
    return { kind: "result", eventIndex, ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }), text: text.text, markers: eventMarkers(event, eventIndex, [text]) };
  }
  if (event.kind === "tool_result") {
    const [text, fields] = resultText(event);
    return { kind: payload?.isError === true ? "error" : "result", eventIndex, ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }), text: text.text, markers: eventMarkers(event, eventIndex, fields) };
  }
  return undefined;
};

const earliestTimestamp = (events: readonly HarnessTraceEvent[]): string | "unknown" => {
  const timestamps = events.flatMap((event) => event.timestamp === undefined ? [] : [event.timestamp]);
  if (timestamps.length === 0) return "unknown";
  return timestamps.reduce((earliest, candidate) => Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest);
};

export const buildSessionListItem = (trace: ValidatedTrace): SessionListItem => {
  const runtime = safeText(trace.document.runtime);
  const candidates = trace.document.events.map(itemForEvent);
  const firstRequest = candidates.find((item) => item?.kind === "request");
  const markers = trace.document.events.flatMap((event, index) => {
    const item = candidates[index];
    return item === undefined ? eventMarkers(event, index, []) : item.markers;
  });
  if (runtime.sanitized) markers.push({ kind: "sanitized" });
  return {
    selector: trace.frozenTrace.selector,
    runtime: runtime.text,
    earliestTimestamp: earliestTimestamp(trace.document.events),
    eventCount: trace.document.eventCount,
    byteCount: trace.frozenTrace.byteCount,
    ...(firstRequest === undefined ? {} : { firstRequestExcerpt: firstRequest.text }),
    markers: dedupeMarkers(markers),
  };
};

export const buildSessionReport = (trace: ValidatedTrace): SessionReport => {
  const runtime = safeText(trace.document.runtime);
  const candidatesByEvent = trace.document.events.map(itemForEvent);
  const candidates = candidatesByEvent.filter((item) => item !== undefined);
  const markers = trace.document.events.flatMap((event, index) => {
    const item = candidatesByEvent[index];
    return item === undefined ? eventMarkers(event, index, []) : item.markers;
  });
  if (runtime.sanitized) markers.push({ kind: "sanitized" });
  return {
    selector: trace.frozenTrace.selector,
    runtime: runtime.text,
    items: candidates.slice(0, maximumEvidenceItems),
    omittedItemCount: Math.max(0, candidates.length - maximumEvidenceItems),
    markers: dedupeMarkers(markers),
  };
};

const markerText = (marker: SessionMarker): string => `${marker.kind}${marker.eventIndex === undefined ? "" : `@${marker.eventIndex}`}`;

export const renderSessionReport = (report: SessionReport): string => {
  const header = [
    `selector: ${safeText(String(report.selector)).text}`,
    `runtime: ${safeText(report.runtime).text}`,
  ];
  const items = report.items.map((item) => {
    const timestamp = item.timestamp === undefined ? "unknown" : safeText(item.timestamp).text;
    return `[${item.eventIndex}] ${timestamp} ${item.kind}: ${safeText(item.text).text}`;
  });
  return [...header, ...items, `omitted: ${report.omittedItemCount}`, `markers: ${report.markers.map(markerText).join(", ")}`].join("\n");
};

export const renderSessionList = (items: SessionList): string => items.map((item) => [
  `selector: ${safeText(String(item.selector)).text}`,
  `runtime: ${safeText(item.runtime).text}`,
  `earliest: ${safeText(item.earliestTimestamp).text}`,
  `events: ${item.eventCount}`,
  `bytes: ${item.byteCount}`,
  `request: ${item.firstRequestExcerpt === undefined ? "unknown" : safeText(item.firstRequestExcerpt).text}`,
  `markers: ${item.markers.map(markerText).join(", ")}`,
].join("\n")).join("\n\n");
