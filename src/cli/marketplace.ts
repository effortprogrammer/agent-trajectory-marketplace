import { createInterface } from "node:readline";

import { officialRegistryOrigin } from "../auth/official-origin";
import { MarketplaceCliError, resolveMarketplaceCredential } from "./marketplace-credentials";
import { printMarketplaceHelp } from "./marketplace-help";
import { parseMarketplaceCommand } from "./marketplace-command";
import { datasetArchivePolicy } from "../marketplace/archive-contract";
import { writeCandidateBundle } from "../marketplace/bundle-service";
import { MarketplaceError } from "../marketplace/error";
import { readPublishBundle } from "../marketplace/publish-bundle";
import { createPublishClient, validPublishCredential } from "../marketplace/publish-client";
import { createStatusClient } from "../marketplace/status-client";
import {
  allowedCandidateTraces,
  approvedMembership,
  candidateSearchJson,
  selectionPreviewJson,
  writeBundleFromSelection,
} from "../marketplace/selection-upload";
import { createWalletBalanceClient } from "../marketplace/wallet-balance-client";
import { runFrozenReview } from "../marketplace/review-loop";
import type { ReviewIO } from "../marketplace/review-loop";
import {
  buildSessionListItem,
  buildSessionReport,
  renderSessionList,
  renderSessionReport,
} from "../marketplace/session-report";
import { readExplicitTraces, resolveTraceSelector, scanSessionSnapshot } from "../marketplace/session-snapshot";
import type { FrozenTrace, SessionReport, SessionWorkItem, ValidatedTrace } from "../marketplace/session-contract";
import { harnessTraceDocumentSchema } from "../trajectory/adapters/contract";

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

const compactReport = (report: SessionReport): CompactSessionReport => {
  const requests: SessionWorkItem[] = [];
  const actions: SessionWorkItem[] = [];
  const results: SessionWorkItem[] = [];
  const errors: SessionWorkItem[] = [];
  for (const item of report.items) {
    switch (item.kind) {
      case "request":
        requests.push(item);
        break;
      case "action":
        actions.push(item);
        break;
      case "result":
        results.push(item);
        break;
      case "error":
        errors.push(item);
        break;
    }
  }
  return {
    selector: report.selector,
    runtime: report.runtime,
    requests,
    actions,
    results,
    errors,
    omittedItemCount: report.omittedItemCount,
    markers: report.markers,
  };
};

export const isMarketplaceInvocation = (argumentsList: readonly string[]): boolean => {
  const offset = argumentsList[0] === "trajectory" ? 1 : 0;
  return argumentsList[offset] === "marketplace";
};

export const runMarketplaceCli = async (
  argumentsList: readonly string[],
  signal: AbortSignal,
): Promise<void> => {
  const executableOffset = argumentsList[0] === "trajectory" ? 1 : 0;
  const marketplaceArguments = argumentsList.slice(executableOffset);
  if (printMarketplaceHelp(marketplaceArguments)) return;
  const command = parseMarketplaceCommand(argumentsList);
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
    case "candidate-bundle": {
      if (command.mode === "preview") {
        process.stdout.write(selectionPreviewJson(command.root, command.denyPolicy));
        return;
      }
      if (command.mode === "selection") {
        console.log(JSON.stringify(writeBundleFromSelection(command.root, command.selection, command.out, command.denyPolicy)));
        return;
      }
      if (command.mode === "explicit") {
        const snapshot = readExplicitTraces(command.root, command.traces);
        const selected = allowedCandidateTraces(snapshot.root, snapshot.traces, command.denyPolicy);
        console.log(JSON.stringify(writeCandidateBundle(snapshot, selected, command.out)));
        return;
      }
      if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        throw new MarketplaceError("invalid_bundle_request");
      }
      const scanned = scanSessionSnapshot(command.root);
      const snapshot = { ...scanned, traces: allowedCandidateTraces(scanned.root, scanned.traces, command.denyPolicy) };
      for (const selector of command.excludes) resolveTraceSelector(snapshot, selector);
      const lineReader = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      const lines = lineReader[Symbol.asyncIterator]();
      let initialExclusion = command.excludes.length > 0;
      let aborted = false;
      let resolveCancellation: (() => void) | undefined;
      const cancellation = new Promise<undefined>((resolve) => {
        resolveCancellation = (): void => resolve(undefined);
      });
      const cancel = (): void => {
        aborted = true;
        resolveCancellation?.();
        lineReader.close();
      };
      const io: ReviewIO = {
        isTTY: true,
        write: (line: string): void => console.log(line),
        readLine: async (): Promise<string | undefined> => {
          if (initialExclusion) {
            initialExclusion = false;
            return `exclude ${command.excludes.join(" ")}`;
          }
          return Promise.race([
            lines.next().then((line) => line.done ? undefined : line.value),
            cancellation,
          ]);
        },
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      try {
        const outcome = await runFrozenReview({
          traces: snapshot.traces,
          maximumIncludedByteCount: datasetArchivePolicy.maxTotalUncompressedBytes,
          io,
          renderInspect: (trace) => renderSessionReport(buildSessionReport(parseFrozenTrace(trace))),
          cancellation: {
            get aborted(): boolean {
              return aborted;
            },
          },
        });
        if (outcome.kind === "approved") {
          console.log(JSON.stringify(writeCandidateBundle(snapshot, outcome.traces, command.out)));
          return;
        }
        console.log(JSON.stringify({ status: outcome.kind }));
        return;
      } finally {
        signal.removeEventListener("abort", cancel);
        lineReader.close();
      }
    }
    case "candidate-search": {
      console.log(candidateSearchJson(command.root, command.query, command.denyPolicy));
      return;
    }
    case "candidate-publish": {
      const server = officialRegistryOrigin;
      const bundle = readPublishBundle(command.bundle);
      const membership = command.selection === undefined
        ? undefined
        : approvedMembership(bundle, command.selection);
      const credential = resolveMarketplaceCredential(server, command.apiKey, "missing_publish_credential");
      const receipt = await createPublishClient(server).publish({
        bundle,
        credential,
        signal,
      });
      console.log(JSON.stringify(membership === undefined ? receipt : { ...receipt, membership }));
      return;
    }
    case "candidate-status": {
      const credential = resolveMarketplaceCredential(
        officialRegistryOrigin,
        command.apiKey,
        "missing_publish_credential",
      );
      const status = await createStatusClient(officialRegistryOrigin).read({
        credential,
        signal,
        submissionId: command.submissionId,
      });
      console.log(JSON.stringify(status));
      return;
    }
    case "wallet-balance": {
      const server = officialRegistryOrigin;
      const credential = resolveMarketplaceCredential(server, command.apiKey, "missing_wallet_credential");
      const response = await createWalletBalanceClient(server).read({ credential, signal });
      console.log(JSON.stringify(response));
      return;
    }
    case "invalid_bundle_request":
      throw new MarketplaceError("invalid_bundle_request");
    case "invalid_command":
      throw new MarketplaceCliError("invalid_command");
  }
  const exhaustive: never = command;
  return exhaustive;
};
