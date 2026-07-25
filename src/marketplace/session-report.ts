import {
  containsReportText,
  containsTruncatedObject,
  safeText,
  storedValue,
  truncationMarker,
  type SafeText,
} from "./report-value";
import { MarketplaceError } from "./error";
import {
  sanitizeHarnessPayload,
  type HarnessTraceEvent,
} from "../trajectory/adapters/contract";
import type {
  SessionList,
  SessionListItem,
  SessionMarker,
  SessionReport,
  SessionWorkItem,
  ValidatedTrace,
} from "./session-contract";

const maximumEvidenceItems = 200;
const knownEventKinds = new Set([
  "session_start", "function_enter", "function_exit", "llm_call", "tool_call", "tool_result",
]);

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
  if (containsReportText(payload, (text) => text.includes("[redacted]")) || fields.some((field) => field.text.includes("[redacted]"))) {
    markers.push({ kind: "redacted", eventIndex });
  }
  if (
    payload?.truncated === true || containsTruncatedObject(payload) ||
    containsReportText(payload, (text) => text.includes(truncationMarker)) || fields.some((field) => field.truncated)
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

const sanitizedEvent = (event: HarnessTraceEvent): HarnessTraceEvent => {
  if (event.payload === undefined) return event;
  const payload = sanitizeHarnessPayload(event.payload);
  if (payload === undefined) throw new MarketplaceError("invalid_trace");
  return { ...event, payload };
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

const reportEvents = (trace: ValidatedTrace): readonly HarnessTraceEvent[] =>
  trace.document.events.map(sanitizedEvent);

export const buildSessionListItem = (trace: ValidatedTrace): SessionListItem => {
  const events = reportEvents(trace);
  const runtime = safeText(trace.document.runtime);
  const candidates = events.map(itemForEvent);
  const firstRequest = candidates.find((item) => item?.kind === "request");
  const markers = events.flatMap((event, index) => {
    const item = candidates[index];
    return item === undefined ? eventMarkers(event, index, []) : item.markers;
  });
  if (runtime.sanitized) markers.push({ kind: "sanitized" });
  return {
    selector: trace.frozenTrace.selector,
    runtime: runtime.text,
    earliestTimestamp: earliestTimestamp(events),
    eventCount: trace.document.eventCount,
    byteCount: trace.frozenTrace.byteCount,
    ...(firstRequest === undefined ? {} : { firstRequestExcerpt: firstRequest.text }),
    markers: dedupeMarkers(markers),
  };
};

export const buildSessionReport = (trace: ValidatedTrace): SessionReport => {
  const events = reportEvents(trace);
  const runtime = safeText(trace.document.runtime);
  const candidatesByEvent = events.map(itemForEvent);
  const candidates = candidatesByEvent.filter((item) => item !== undefined);
  const markers = events.flatMap((event, index) => {
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
