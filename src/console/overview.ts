import type { SessionList, SessionListItem } from "../marketplace/session-contract";
import type {
  ConsoleDailyRow,
  ConsoleOverview,
  EgressPreview,
  PrivacyRuleCount,
} from "./contract";

type DayTally = { sessionCount: number; eventCount: number; byteCount: number; redactedSessionCount: number };

const hasRedactedMarker = (item: SessionListItem): boolean =>
  item.markers.some((marker) => marker.kind === "redacted");

const dayOf = (item: SessionListItem): string | undefined => {
  if (item.earliestTimestamp === "unknown") return undefined;
  const parsed = new Date(item.earliestTimestamp);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
};

const dayRows = (items: SessionList): readonly ConsoleDailyRow[] => {
  const tallies = new Map<string, DayTally>();
  for (const item of items) {
    const day = dayOf(item);
    if (day === undefined) continue;
    const tally = tallies.get(day) ?? {
      sessionCount: 0,
      eventCount: 0,
      byteCount: 0,
      redactedSessionCount: 0,
    };
    tally.sessionCount += 1;
    tally.eventCount += item.eventCount;
    tally.byteCount += item.byteCount;
    if (hasRedactedMarker(item)) tally.redactedSessionCount += 1;
    tallies.set(day, tally);
  }
  return [...tallies.entries()]
    .map(([day, tally]) => ({ day, ...tally }))
    .sort((left, right) => right.day.localeCompare(left.day));
};

const runtimeRows = (
  items: SessionList,
): readonly Readonly<{ runtime: string; count: number }>[] => {
  const tallies = new Map<string, number>();
  for (const item of items) tallies.set(item.runtime, (tallies.get(item.runtime) ?? 0) + 1);
  return [...tallies.entries()]
    .map(([runtime, count]) => ({ runtime, count }))
    .sort((left, right) =>
      right.count - left.count || left.runtime.localeCompare(right.runtime),
    );
};

export const buildConsoleOverview = (items: SessionList): ConsoleOverview => ({
  sessionCount: items.length,
  eventCount: items.reduce((total, item) => total + item.eventCount, 0),
  byteCount: items.reduce((total, item) => total + item.byteCount, 0),
  redactedSessionCount: items.filter(hasRedactedMarker).length,
  runtimeCounts: runtimeRows(items),
  days: dayRows(items),
  undatedSessionCount: items.filter((item) => dayOf(item) === undefined).length,
});

export const buildEgressPreview = (
  items: SessionList,
  selectors: readonly string[],
  ruleCounts: readonly PrivacyRuleCount[],
): EgressPreview => {
  const requested = new Set(selectors);
  const selected = items.filter((item) => requested.has(item.selector));
  return {
    selectedCount: selected.length,
    availableCount: items.length,
    byteCount: selected.reduce((total, item) => total + item.byteCount, 0),
    eventCount: selected.reduce((total, item) => total + item.eventCount, 0),
    ruleCounts,
    selectors: selected.map((item) => item.selector),
  };
};
