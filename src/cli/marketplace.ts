import { createInterface } from "node:readline";

import { officialRegistryOrigin } from "../auth/official-origin";
import { MarketplaceCliError, resolveMarketplaceCredential } from "./marketplace-credentials";
import { printMarketplaceHelp } from "./marketplace-help";
import { parseMarketplaceCommand } from "./marketplace-command";
import {
  renderFrozenSessionReport,
  runMarketplaceSessionCommand,
} from "./marketplace-session-command";
import { datasetArchivePolicy } from "../marketplace/archive-contract";
import {
  writeCandidateBundle,
  writeCandidateBundleWithPrivateReview,
} from "../marketplace/bundle-service";
import { MarketplaceError } from "../marketplace/error";
import { readPublishBundle } from "../marketplace/publish-bundle";
import { createPublishClient } from "../marketplace/publish-client";
import { createStatusClient } from "../marketplace/status-client";
import {
  allowedCandidateTraces,
  approvedMembership,
  candidateSearchJson,
  selectionPreviewJson,
  writeBundleFromSelection,
} from "../marketplace/selection-upload";
import { createWalletBalanceClient } from "../marketplace/wallet-balance-client";
import { createSellerSalesClient } from "../marketplace/seller-sales-client";
import { createPayoutRequestClient } from "../marketplace/payout-request-client";
import { readStoredAuthSession, storedAuthSessionStatus } from "../auth/store";
import { runFrozenReview } from "../marketplace/review-loop";
import type { ReviewIO } from "../marketplace/review-loop";
import {
  readExplicitTraces,
  resolveTraceSelector,
  scanSessionSnapshot,
} from "../marketplace/session-snapshot";

export const isMarketplaceInvocation = (argumentsList: readonly string[]): boolean => {
  const offset = argumentsList[0] === "trajectory" ? 1 : 0;
  return argumentsList[offset] === "marketplace";
};

const sellerSessionCredential = (): string => {
  const session = readStoredAuthSession(officialRegistryOrigin);
  if (session === undefined || storedAuthSessionStatus(session) !== "active") {
    throw new MarketplaceCliError("missing_seller_session");
  }
  return session.accessToken;
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
    case "sessions-list":
    case "sessions-inspect":
    case "sessions-choose": {
      runMarketplaceSessionCommand(command);
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
        const result = command.review === undefined
          ? writeCandidateBundle(snapshot, selected, command.out)
          : writeCandidateBundleWithPrivateReview(snapshot, selected, command.out, command.review);
        console.log(JSON.stringify(result));
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
          renderInspect: renderFrozenSessionReport,
          cancellation: {
            get aborted(): boolean {
              return aborted;
            },
          },
        });
        if (outcome.kind === "approved") {
          const result = command.review === undefined
            ? writeCandidateBundle(snapshot, outcome.traces, command.out)
            : writeCandidateBundleWithPrivateReview(snapshot, outcome.traces, command.out, command.review);
          console.log(JSON.stringify(result));
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
      const membership = approvedMembership(bundle, command.selection);
      const credential = resolveMarketplaceCredential(server, command.apiKey, "missing_publish_credential");
      const receipt = await createPublishClient(server).publish({
        bundle,
        credential,
        signal,
      });
      console.log(JSON.stringify({ ...receipt, membership }));
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
    case "seller-read": {
      const response = await createSellerSalesClient(officialRegistryOrigin).read(
        command.resource,
        sellerSessionCredential(),
        command.options,
        signal,
      );
      console.log(JSON.stringify(response));
      return;
    }
    case "payout": {
      const credential = sellerSessionCredential();
      const client = createPayoutRequestClient(officialRegistryOrigin);
      if (command.action === "status") {
        console.log(JSON.stringify(await client.read({ credential, signal })));
        return;
      }
      if (command.operationId === undefined) throw new MarketplaceCliError("invalid_command");
      const response = command.action === "request"
        ? await client.create({ credential, operationId: command.operationId, signal })
        : await client.withdraw({ credential, operationId: command.operationId, signal });
      console.log(JSON.stringify(response));
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
