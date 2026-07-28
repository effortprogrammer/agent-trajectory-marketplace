import { isSensitiveObjectKey } from "../trajectory/adapters/payload-redaction";
import { truncationMarker } from "../marketplace/report-value";
import { findingWindow } from "./excerpt";
import type { ValidatedTrace } from "../marketplace/session-contract";
import type { HarnessTraceEvent } from "../trajectory/adapters/contract";
import { privacyRuleFamilies } from "./contract";
import type { PrivacyFinding, PrivacyRuleCount, PrivacyRuleFamily, PrivacySummary } from "./contract";

const maximumFindings = 200;
const redactionPlaceholder = "[redacted]";
const controlMarkerPattern = /\[(?:control|bidi):U\+[0-9A-F]{4}\]/u;

type TextSite = Readonly<{ path: string; key: string | undefined; text: string }>;

const joinPath = (parent: string, segment: string): string =>
  parent === "" ? segment : `${parent}.${segment}`;

const collectTextSites = (payload: unknown): readonly TextSite[] => {
  const sites: TextSite[] = [];
  const stack: Readonly<{ value: unknown; path: string; key: string | undefined }>[] = [
    { value: payload, path: "", key: undefined },
  ];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    const { value, path, key } = frame;
    if (typeof value === "string") {
      sites.push({ path, key, text: value });
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: joinPath(path, String(index)), key });
      }
      continue;
    }
    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      stack.push({ value: entry[1], path: joinPath(path, entry[0]), key: entry[0] });
    }
  }
  return sites;
};

const familiesForSite = (site: TextSite): readonly PrivacyRuleFamily[] => {
  const families: PrivacyRuleFamily[] = [];
  if (site.text.includes(redactionPlaceholder)) {
    families.push(
      site.key !== undefined && isSensitiveObjectKey(site.key)
        ? "sensitive_key"
        : "credential_pattern",
    );
  }
  if (site.text.includes(truncationMarker)) families.push("oversized_value");
  if (controlMarkerPattern.test(site.text)) families.push("terminal_control");
  return families;
};

const markerFor = (family: PrivacyRuleFamily, text: string): string => {
  if (family === "oversized_value") return truncationMarker;
  if (family !== "terminal_control") return redactionPlaceholder;
  return controlMarkerPattern.exec(text)?.[0] ?? redactionPlaceholder;
};

const eventSites = (event: HarnessTraceEvent): readonly TextSite[] =>
  event.payload === undefined ? [] : collectTextSites(event.payload);

const orderedCounts = (tally: ReadonlyMap<PrivacyRuleFamily, number>): readonly PrivacyRuleCount[] =>
  privacyRuleFamilies
    .map((family) => ({ family, count: tally.get(family) ?? 0 }))
    .filter((entry) => entry.count > 0);

export const summarizePrivacyFiltering = (trace: ValidatedTrace): PrivacySummary => {
  const tally = new Map<PrivacyRuleFamily, number>();
  const findings: PrivacyFinding[] = [];
  let totalFindings = 0;

  trace.document.events.forEach((event, eventIndex) => {
    for (const site of eventSites(event)) {
      for (const family of familiesForSite(site)) {
        tally.set(family, (tally.get(family) ?? 0) + 1);
        totalFindings += 1;
        if (findings.length >= maximumFindings) continue;
        findings.push({
          family,
          eventIndex,
          path: site.path,
          storedText: findingWindow(site.text, markerFor(family, site.text)),
          ...(family === "sensitive_key" && site.key !== undefined ? { keyName: site.key } : {}),
        });
      }
    }
  });

  return {
    selector: trace.frozenTrace.selector,
    runtime: trace.frozenTrace.runtime,
    eventCount: trace.document.events.length,
    byteCount: trace.frozenTrace.byteCount,
    ruleCounts: orderedCounts(tally),
    findings,
    omittedFindingCount: totalFindings - findings.length,
  };
};
