import { safeText } from "./report-value";
import type {
  SessionMarker,
  SessionSummary,
  SessionWorkItem,
} from "./session-contract";

const maximumSummaryRequests = 8;
const maximumSummaryTouched = 8;
const maximumSummaryErrors = 5;
const requestClipCharacters = 160;
const touchedClipCharacters = 120;
const errorClipCharacters = 160;

export type SessionSummaryInput = Readonly<{
  readonly requests: readonly SessionWorkItem[];
  readonly actions: readonly SessionWorkItem[];
  readonly results: readonly SessionWorkItem[];
  readonly errors: readonly SessionWorkItem[];
  readonly markers: readonly SessionMarker[];
}>;

const clipText = (text: string, maximumCharacters: number): string => {
  const characters = Array.from(text);
  if (characters.length <= maximumCharacters) return text;
  return `${characters.slice(0, maximumCharacters - 1).join("")}…`;
};

const distinctCapped = (values: readonly string[], cap: number): readonly string[] => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    kept.push(value);
    if (kept.length >= cap) break;
  }
  return kept;
};

const countMarkerKind = (markers: readonly SessionMarker[], kind: SessionMarker["kind"]): number =>
  markers.filter((marker) => marker.kind === kind).length;

export const buildSessionSummary = (input: SessionSummaryInput): SessionSummary => ({
  requests: distinctCapped(
    input.requests.map((item) => clipText(item.text, requestClipCharacters)),
    maximumSummaryRequests,
  ),
  touched: distinctCapped(
    input.actions.map((item) => clipText(item.text, touchedClipCharacters)),
    maximumSummaryTouched,
  ),
  errors: input.errors.slice(0, maximumSummaryErrors).map((item) => ({
    eventIndex: item.eventIndex,
    text: clipText(item.text, errorClipCharacters),
  })),
  counts: {
    requests: input.requests.length,
    actions: input.actions.length,
    results: input.results.length,
    errors: input.errors.length,
    redacted: countMarkerKind(input.markers, "redacted"),
    truncated: countMarkerKind(input.markers, "truncated"),
  },
});

export const renderSummaryBlock = (summary: SessionSummary): readonly string[] => {
  const asks = summary.requests.length === 0
    ? "none"
    : summary.requests.map((text) => safeText(text).text).join(" / ");
  const touched = summary.touched.length === 0
    ? "none"
    : summary.touched.map((text) => safeText(text).text).join(" · ");
  const errors = summary.errors.length === 0
    ? "none"
    : `${summary.counts.errors} (${summary.errors.map((error) => safeText(error.text).text).join(" / ")})`;
  return [
    `asks: ${asks}`,
    `touched: ${touched}`,
    `errors: ${errors}`,
    `masking: ${summary.counts.redacted} redacted · ${summary.counts.truncated} truncated`,
  ];
};
