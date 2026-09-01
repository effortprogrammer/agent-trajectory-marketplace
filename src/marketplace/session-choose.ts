import { datasetArchivePolicy } from "./archive-contract";
import { writeBundleOutput } from "./bundle-output";
import {
  assessTraceCompensatedUsage,
  inspectTraceAdmission,
} from "./dataset-archive";
import {
  aggregateCompensatedUsage,
  hasSupportedPositiveUsage,
} from "./compensated-model-policy";
import type { ArtifactAdmission } from "./dataset-archive";
import { MarketplaceError } from "./error";
import { safeText } from "./report-value";
import {
  SelectionContractError,
  encodeSelectionDocument,
  selectionDocumentMaximumBytes,
  selectionDocumentFromTraces,
} from "./selection-contract";
import type { SelectionTrace } from "./selection-contract";
import { resolveTraceSelector, scanSessionSnapshot } from "./session-snapshot";

export type SessionChoiceApproval = Readonly<{
  readonly selector: string;
  readonly sha256: string;
}>;

export type SessionChoice = Readonly<{
  readonly admission: ArtifactAdmission;
  readonly approval: string;
  readonly byteCount: number;
  readonly earliestTimestamp: string;
  readonly eventCount: number;
  readonly runtime: string;
  readonly runtimeAttribution?: "operator_declared";
  readonly sha256: string;
  readonly selector: string;
  readonly summary: SelectionTrace["summary"];
  readonly topic: string;
}>;

export type SessionChoicePreview = Readonly<{
  readonly root: string;
  readonly schemaVersion: 1;
  readonly sessions: readonly SessionChoice[];
}>;

export type SessionChoiceWriteResult = Readonly<{
  readonly outputPath: string;
  readonly selectors: readonly string[];
  readonly traceCount: number;
}>;

const machineRequestPrefixes = [
  "<conversation_history>",
  "<omo-senpi-task>",
  "<system-reminder>",
] as const;

const topicFor = (trace: SelectionTrace): string =>
  trace.summary.requests.find((request) =>
    !machineRequestPrefixes.some((prefix) => request.trimStart().startsWith(prefix)))
  ?? "No user request found";

const withheldSummary = (summary: SelectionTrace["summary"]): SelectionTrace["summary"] =>
  Object.freeze({
    counts: summary.counts,
    errors: Object.freeze([]),
    requests: Object.freeze([]),
    touched: Object.freeze([]),
  });

export const previewSessionChoices = (root: string): SessionChoicePreview => {
  const snapshot = scanSessionSnapshot(root);
  if (snapshot.traces.length > datasetArchivePolicy.maxTraces) {
    throw new MarketplaceError("invalid_bundle_request");
  }
  const tracesBySelector = new Map(snapshot.traces.map((trace) => [trace.selector, trace]));
  const document = selectionDocumentFromTraces(snapshot.root, snapshot.traces);
  const sessions = document.traces.map((trace) => {
    const frozen = tracesBySelector.get(trace.selector);
    if (frozen === undefined) throw new MarketplaceError("missing_selector");
    const admission = inspectTraceAdmission(frozen);
    const ready = admission.status === "ready";
    return Object.freeze({
      admission,
      approval: `${trace.selector}@${trace.sha256}`,
      byteCount: trace.byteCount,
      earliestTimestamp: ready ? trace.earliestTimestamp : "withheld",
      eventCount: trace.eventCount,
      runtime: ready ? trace.runtime : "withheld",
      ...(ready && trace.runtimeAttribution !== undefined
        ? { runtimeAttribution: trace.runtimeAttribution }
        : {}),
      sha256: trace.sha256,
      selector: trace.selector,
      summary: ready ? trace.summary : withheldSummary(trace.summary),
      topic: ready ? topicFor(trace) : `Content withheld: ${admission.reason}`,
    });
  });
  const preview = Object.freeze({
    root: snapshot.root,
    schemaVersion: 1,
    sessions: Object.freeze(sessions),
  });
  if (Buffer.byteLength(JSON.stringify(preview), "utf8") > selectionDocumentMaximumBytes) {
    throw new MarketplaceError("invalid_bundle_request");
  }
  return preview;
};

export const renderSessionChoices = (preview: SessionChoicePreview): string =>
  preview.sessions.map((session) => {
    const admission = session.admission.status === "ready"
      ? "ready"
      : `blocked:${session.admission.reason}`;
    return [
      `[${admission}] ${session.selector}`,
      `  ${safeText(session.runtime).text} · ${safeText(session.earliestTimestamp).text} · ${session.eventCount} events`,
      `  ${safeText(session.topic).text}`,
      `  approve: ${session.approval}`,
    ].join("\n");
  }).join("\n\n");

export const writeSessionChoiceDocument = (
  root: string,
  approvals: readonly SessionChoiceApproval[],
  outputPath: string,
): SessionChoiceWriteResult => {
  if (approvals.length === 0) throw new MarketplaceError("empty_selection");
  if (approvals.length > datasetArchivePolicy.maxTraces) {
    throw new MarketplaceError("invalid_bundle_request");
  }
  if (new Set(approvals.map((approval) => approval.selector)).size !== approvals.length) {
    throw new MarketplaceError("duplicate_trace");
  }
  const snapshot = scanSessionSnapshot(root);
  const selected = approvals.map((approval) => {
    const trace = resolveTraceSelector(snapshot, approval.selector);
    if (trace.hash !== approval.sha256) throw new MarketplaceError("trace_drift");
    return trace;
  });
  if (new Set(selected.map((trace) => trace.hash)).size !== selected.length) {
    throw new MarketplaceError("duplicate_trace");
  }
  if (selected.some((trace) => inspectTraceAdmission(trace).status === "blocked")) {
    throw new MarketplaceError("denied_selection");
  }
  if (!hasSupportedPositiveUsage(aggregateCompensatedUsage(
    selected.map(assessTraceCompensatedUsage),
  ))) {
    throw new MarketplaceError("denied_selection");
  }
  const document = selectionDocumentFromTraces(snapshot.root, selected);
  if (
    new Set(document.traces.map((trace) => trace.artifactSha256)).size
      !== document.traces.length
  ) {
    throw new MarketplaceError("duplicate_trace");
  }
  let encoded: Buffer;
  try {
    encoded = encodeSelectionDocument(document);
  } catch (error) {
    if (error instanceof SelectionContractError) {
      throw new MarketplaceError("invalid_bundle_request");
    }
    throw error;
  }
  writeBundleOutput(outputPath, encoded);
  return Object.freeze({
    outputPath,
    selectors: Object.freeze(document.traces.map((trace) => trace.selector)),
    traceCount: document.traces.length,
  });
};
