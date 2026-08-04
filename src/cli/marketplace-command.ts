import { isAbsolute } from "node:path";

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

type InteractiveCandidateBundleCommand = Readonly<{
  readonly command: "candidate-bundle";
  readonly excludes: readonly string[];
  readonly mode: "interactive";
  readonly out: string;
  readonly root: string;
}>;

type ExplicitCandidateBundleCommand = Readonly<{
  readonly command: "candidate-bundle";
  readonly mode: "explicit";
  readonly out: string;
  readonly root: string;
  readonly traces: readonly string[];
}>;

type CandidatePublishCommand = Readonly<{
  readonly apiKey?: string;
  readonly bundle: string;
  readonly command: "candidate-publish";
  readonly server: string;
}>;

type WalletBalanceCommand = Readonly<{
  readonly apiKey: string | undefined;
  readonly command: "wallet-balance";
  readonly server: string;
}>;

type InvalidCommand = Readonly<{ readonly command: "invalid_command" }>;
type InvalidBundleRequest = Readonly<{
  readonly command: "invalid_bundle_request";
}>;

export type MarketplaceCommand =
  | SessionsListCommand
  | SessionsInspectCommand
  | InteractiveCandidateBundleCommand
  | ExplicitCandidateBundleCommand
  | CandidatePublishCommand
  | WalletBalanceCommand
  | InvalidCommand
  | InvalidBundleRequest;

const fullSelector = /^s-[0-9a-f]{64}$/;

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

const parseCandidateBundle = (
  argumentsList: readonly string[],
): MarketplaceCommand => {
  let out: string | undefined;
  let root: string | undefined;
  const excludes: string[] = [];
  const traces: string[] = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidBundleRequest();
    if (option === "--root") {
      if (root !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      root = value;
    } else if (option === "--out") {
      if (out !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      out = value;
    } else if (option === "--exclude") {
      if (!fullSelector.test(value)) return invalidBundleRequest();
      excludes.push(value);
    } else if (option === "--trace") {
      if (!isExplicitTrace(value)) return invalidBundleRequest();
      traces.push(value);
    } else {
      return invalidBundleRequest();
    }
    index += 1;
  }
  if (root === undefined || out === undefined || (traces.length > 0 && excludes.length > 0)) {
    return invalidBundleRequest();
  }
  return traces.length > 0
    ? { command: "candidate-bundle", mode: "explicit", out, root, traces }
    : { command: "candidate-bundle", excludes, mode: "interactive", out, root };
};

const parseCandidatePublish = (argumentsList: readonly string[]): MarketplaceCommand => {
  let apiKey: string | undefined;
  let bundle: string | undefined;
  let server: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidCommand();
    if (option === "--bundle" && bundle === undefined && isAbsolutePath(value)) bundle = value;
    else if (option === "--server" && server === undefined) server = value;
    else if (option === "--api-key" && apiKey === undefined && value.length > 0) apiKey = value;
    else return invalidCommand();
    index += 1;
  }
  return bundle === undefined || server === undefined
    ? invalidCommand()
    : apiKey === undefined
      ? { bundle, command: "candidate-publish", server }
      : { apiKey, bundle, command: "candidate-publish", server };
};

const parseWalletBalance = (argumentsList: readonly string[]): MarketplaceCommand => {
  if (argumentsList.length !== 2 && argumentsList.length !== 4) return invalidCommand();
  const [serverFlag, server, apiKeyFlag, apiKey] = argumentsList;
  if (
    serverFlag !== "--server" ||
    server === undefined ||
    server.length === 0 ||
    server.startsWith("--")
  ) return invalidCommand();
  if (argumentsList.length === 2) return { apiKey: undefined, command: "wallet-balance", server };
  return apiKeyFlag === "--api-key" && apiKey !== undefined && apiKey.length > 0 && !apiKey.startsWith("--")
    ? { apiKey, command: "wallet-balance", server }
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
  if (group === "candidate" && action === "bundle") {
    return parseCandidateBundle(argumentsWithoutExecutable.slice(4));
  }
  if (group === "candidate" && action === "publish") {
    return parseCandidatePublish(argumentsWithoutExecutable.slice(4));
  }
  if (group === "wallet" && action === "balance") {
    return parseWalletBalance(argumentsWithoutExecutable.slice(4));
  }
  return invalidCommand();
};
