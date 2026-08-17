import { isAbsolute } from "node:path";

import {
  parseCandidateBundle,
  parseCandidatePublish,
  parseCandidateSearch,
  parseCandidateStatus,
} from "./marketplace-candidate-command";
import type {
  CandidatePublishCommand,
  CandidateSearchCommand,
  CandidateStatusCommand,
  ExplicitCandidateBundleCommand,
  InteractiveCandidateBundleCommand,
  PreviewCandidateBundleCommand,
  SelectionCandidateBundleCommand,
} from "./marketplace-candidate-command";

type SessionsListCommand = Readonly<{
  readonly command: "sessions-list";
  readonly json: boolean;
  readonly root: string;
}>;

type SessionsInspectCommand = Readonly<{
  readonly command: "sessions-inspect";
  readonly json: boolean;
  readonly root: string;
  readonly selector: string;
}>;

type SessionsChooseCommand =
  | Readonly<{
    readonly command: "sessions-choose";
    readonly json: boolean;
    readonly mode: "preview";
    readonly root: string;
  }>
  | Readonly<{
    readonly approvals: readonly Readonly<{ readonly selector: string; readonly sha256: string }>[];
    readonly command: "sessions-choose";
    readonly mode: "write";
    readonly out: string;
    readonly root: string;
  }>;

type WalletBalanceCommand = Readonly<{
  readonly apiKey: string | undefined;
  readonly command: "wallet-balance";
}>;

type InvalidCommand = Readonly<{ readonly command: "invalid_command" }>;
type InvalidBundleRequest = Readonly<{
  readonly command: "invalid_bundle_request";
}>;

export type MarketplaceCommand =
  | SessionsListCommand
  | SessionsInspectCommand
  | SessionsChooseCommand
  | InteractiveCandidateBundleCommand
  | ExplicitCandidateBundleCommand
  | PreviewCandidateBundleCommand
  | SelectionCandidateBundleCommand
  | CandidateSearchCommand
  | CandidatePublishCommand
  | CandidateStatusCommand
  | WalletBalanceCommand
  | InvalidCommand
  | InvalidBundleRequest;

const fullSelector = /^s-[0-9a-f]{64}$/;
const fullApproval = /^(s-[0-9a-f]{64})@([0-9a-f]{64})$/;

const invalidCommand = (): InvalidCommand => ({ command: "invalid_command" });
const invalidBundleRequest = (): InvalidBundleRequest => ({
  command: "invalid_bundle_request",
});

const isAbsolutePath = (value: string): boolean => value.length > 0 && isAbsolute(value);

const isExplicitTrace = (value: string): boolean => {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    !value.endsWith(".atf.json")
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const parseSessionsList = (argumentsList: readonly string[]): MarketplaceCommand => {
  let json = false;
  let root: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (option === "--json") {
      if (json) return invalidCommand();
      json = true;
      continue;
    }
    if (option !== "--root" || root !== undefined) return invalidCommand();
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--") || !isAbsolutePath(value)) {
      return invalidCommand();
    }
    root = value;
    index += 1;
  }
  return root === undefined
    ? invalidCommand()
    : { command: "sessions-list", json, root };
};

const parseSessionsInspect = (
  selector: string | undefined,
  argumentsList: readonly string[],
): MarketplaceCommand => {
  if (selector === undefined || !fullSelector.test(selector)) return invalidCommand();
  let json = false;
  let root: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (option === "--json") {
      if (json) return invalidCommand();
      json = true;
      continue;
    }
    if (option !== "--root" || root !== undefined) return invalidCommand();
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--") || !isAbsolutePath(value)) {
      return invalidCommand();
    }
    root = value;
    index += 1;
  }
  return root === undefined
    ? invalidCommand()
    : { command: "sessions-inspect", json, root, selector };
};

const parseSessionsChoose = (argumentsList: readonly string[]): MarketplaceCommand => {
  let json = false;
  let out: string | undefined;
  let root: string | undefined;
  const approvals: Array<Readonly<{ readonly selector: string; readonly sha256: string }>> = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (option === "--json") {
      if (json) return invalidCommand();
      json = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidCommand();
    if (option === "--root" && root === undefined && isAbsolutePath(value)) {
      root = value;
    } else if (option === "--out" && out === undefined && isAbsolutePath(value)) {
      out = value;
    } else if (option === "--approve") {
      const match = fullApproval.exec(value);
      if (match?.[1] === undefined || match[2] === undefined) return invalidCommand();
      approvals.push({ selector: match[1], sha256: match[2] });
    } else {
      return invalidCommand();
    }
    index += 1;
  }
  if (root === undefined) return invalidCommand();
  if (out === undefined) {
    return approvals.length === 0
      ? { command: "sessions-choose", json, mode: "preview", root }
      : invalidCommand();
  }
  return !json && approvals.length > 0
    ? { approvals, command: "sessions-choose", mode: "write", out, root }
    : invalidCommand();
};

const parseWalletBalance = (argumentsList: readonly string[]): MarketplaceCommand => {
  if (argumentsList.length !== 0 && argumentsList.length !== 2) return invalidCommand();
  if (argumentsList.length === 0) return { apiKey: undefined, command: "wallet-balance" };
  const [apiKeyFlag, apiKey] = argumentsList;
  return apiKeyFlag === "--api-key" && apiKey !== undefined && apiKey.length > 0 && !apiKey.startsWith("--")
    ? { apiKey, command: "wallet-balance" }
    : invalidCommand();
};

export const parseMarketplaceCommand = (
  argumentsList: readonly string[],
): MarketplaceCommand => {
  const argumentsWithoutExecutable =
    argumentsList[0] === "trajectory" ? argumentsList.slice(1) : argumentsList;
  if (
    argumentsWithoutExecutable[0] !== "marketplace" ||
    argumentsWithoutExecutable[1] !== "seller"
  ) {
    return invalidCommand();
  }
  const group = argumentsWithoutExecutable[2];
  const action = argumentsWithoutExecutable[3];
  if (group === "sessions" && action === "list") {
    return parseSessionsList(argumentsWithoutExecutable.slice(4));
  }
  if (group === "sessions" && action === "inspect") {
    return parseSessionsInspect(
      argumentsWithoutExecutable[4],
      argumentsWithoutExecutable.slice(5),
    );
  }
  if (group === "sessions" && action === "choose") {
    return parseSessionsChoose(argumentsWithoutExecutable.slice(4));
  }
  if (group === "candidate" && action === "bundle") {
    return parseCandidateBundle(argumentsWithoutExecutable.slice(4));
  }
  if (group === "candidate" && action === "publish") {
    return parseCandidatePublish(argumentsWithoutExecutable.slice(4));
  }
  if (group === "candidate" && action === "search") {
    return parseCandidateSearch(argumentsWithoutExecutable.slice(4));
  }
  if (group === "candidate" && action === "status") {
    return parseCandidateStatus(argumentsWithoutExecutable.slice(4));
  }
  if (group === "wallet" && action === "balance") {
    return parseWalletBalance(argumentsWithoutExecutable.slice(4));
  }
  return invalidCommand();
};
