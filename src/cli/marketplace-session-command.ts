import type { MarketplaceCommand } from "./marketplace-command";
import { MarketplaceError } from "../marketplace/error";
import {
  buildSessionListItem,
  buildSessionReport,
  renderSessionList,
  renderSessionReport,
} from "../marketplace/session-report";
import {
  previewSessionChoices,
  renderSessionChoices,
  writeSessionChoiceDocument,
} from "../marketplace/session-choose";
import { resolveTraceSelector, scanSessionSnapshot } from "../marketplace/session-snapshot";
import type {
  FrozenTrace,
  SessionReport,
  SessionWorkItem,
  ValidatedTrace,
} from "../marketplace/session-contract";
import { harnessTraceDocumentSchema } from "../trajectory/adapters/contract";

type MarketplaceSessionCommand = Extract<
  MarketplaceCommand,
  { readonly command: "sessions-choose" | "sessions-inspect" | "sessions-list" }
>;

type CompactSessionReport = Readonly<{
  readonly selector: SessionReport["selector"];
  readonly runtime: string;
  readonly requests: readonly SessionWorkItem[];
  readonly actions: readonly SessionWorkItem[];
  readonly results: readonly SessionWorkItem[];
  readonly errors: readonly SessionWorkItem[];
  readonly omittedItemCount: number;
  readonly markers: SessionReport["markers"];
}>;

const parseFrozenTrace = (frozenTrace: FrozenTrace): ValidatedTrace => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(frozenTrace.bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new MarketplaceError("invalid_trace");
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new MarketplaceError("invalid_trace");
    throw error;
  }
  const document = harnessTraceDocumentSchema.safeParse(value);
  if (!document.success) throw new MarketplaceError("invalid_trace");
  return { frozenTrace, document: document.data };
};

export const renderFrozenSessionReport = (trace: FrozenTrace): string =>
  renderSessionReport(buildSessionReport(parseFrozenTrace(trace)));

const compactReport = (report: SessionReport): CompactSessionReport => {
  const items = {
    actions: [] as SessionWorkItem[],
    errors: [] as SessionWorkItem[],
    requests: [] as SessionWorkItem[],
    results: [] as SessionWorkItem[],
  };
  for (const item of report.items) items[`${item.kind}s`].push(item);
  return {
    selector: report.selector,
    runtime: report.runtime,
    ...items,
    omittedItemCount: report.omittedItemCount,
    markers: report.markers,
  };
};

export const runMarketplaceSessionCommand = (command: MarketplaceSessionCommand): void => {
  switch (command.command) {
    case "sessions-list": {
      const snapshot = scanSessionSnapshot(command.root);
      const items = snapshot.traces.map((trace) => buildSessionListItem(parseFrozenTrace(trace)));
      console.log(command.json ? JSON.stringify(items) : renderSessionList(items));
      return;
    }
    case "sessions-inspect": {
      const snapshot = scanSessionSnapshot(command.root);
      const trace = resolveTraceSelector(snapshot, command.selector);
      const report = buildSessionReport(parseFrozenTrace(trace));
      console.log(command.json ? JSON.stringify(compactReport(report)) : renderSessionReport(report));
      return;
    }
    case "sessions-choose": {
      if (command.mode === "write") {
        console.log(JSON.stringify(
          writeSessionChoiceDocument(command.root, command.approvals, command.out),
        ));
        return;
      }
      const preview = previewSessionChoices(command.root);
      console.log(command.json ? JSON.stringify(preview) : renderSessionChoices(preview));
    }
  }
};
