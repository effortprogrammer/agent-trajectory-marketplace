import { isAbsolute } from "node:path";

export type PrivateReviewCacheOptions = Readonly<{
  readonly cacheRoot: string;
  readonly policy: string;
}>;

export type InteractiveCandidateBundleCommand = Readonly<{
  readonly command: "candidate-bundle";
  readonly denyPolicy?: string;
  readonly excludes: readonly string[];
  readonly mode: "interactive";
  readonly out: string;
  readonly review?: PrivateReviewCacheOptions;
  readonly root: string;
}>;

export type ExplicitCandidateBundleCommand = Readonly<{
  readonly command: "candidate-bundle";
  readonly denyPolicy?: string;
  readonly mode: "explicit";
  readonly out: string;
  readonly review?: PrivateReviewCacheOptions;
  readonly root: string;
  readonly traces: readonly string[];
}>;

export type PreviewCandidateBundleCommand = Readonly<{
  readonly command: "candidate-bundle";
  readonly denyPolicy?: string;
  readonly mode: "preview";
  readonly root: string;
}>;

export type SelectionCandidateBundleCommand = Readonly<{
  readonly command: "candidate-bundle";
  readonly denyPolicy?: string;
  readonly mode: "selection";
  readonly out: string;
  readonly root: string;
  readonly selection: string;
}>;

export type CandidateSearchCommand = Readonly<{
  readonly command: "candidate-search";
  readonly denyPolicy?: string;
  readonly query: string;
  readonly root: string;
}>;

export type CandidatePublishCommand = Readonly<{
  readonly apiKey?: string;
  readonly bundle: string;
  readonly commercialUse?: "yes" | "no";
  readonly command: "candidate-publish";
  readonly consentPolicy?: string;
  readonly selection: string;
}>;

export type CandidateStatusCommand = Readonly<{
  readonly apiKey?: string;
  readonly command: "candidate-status";
  readonly submissionId: string;
}>;

type InvalidCommand = Readonly<{ readonly command: "invalid_command" }>;
type InvalidBundleRequest = Readonly<{
  readonly command: "invalid_bundle_request";
}>;

export type CandidateCommand =
  | InteractiveCandidateBundleCommand
  | ExplicitCandidateBundleCommand
  | PreviewCandidateBundleCommand
  | SelectionCandidateBundleCommand
  | CandidateSearchCommand
  | CandidatePublishCommand
  | CandidateStatusCommand
  | InvalidCommand
  | InvalidBundleRequest;

const fullSelector = /^s-[0-9a-f]{64}$/;

const invalidCommand = (): InvalidCommand => ({ command: "invalid_command" });
const invalidBundleRequest = (): InvalidBundleRequest => ({
  command: "invalid_bundle_request",
});

const isAbsolutePath = (value: string): boolean => value.length > 0 && isAbsolute(value);

const isReviewPolicy = (value: string): boolean =>
  value.length > 0 && value.length <= 512 && value === value.trim() && !value.includes("\0");

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

export const parseCandidateBundle = (
  argumentsList: readonly string[],
): CandidateCommand => {
  let denyPolicy: string | undefined;
  let out: string | undefined;
  let root: string | undefined;
  let printSelection = false;
  let selection: string | undefined;
  let reviewCache: string | undefined;
  let reviewPolicy: string | undefined;
  const excludes: string[] = [];
  const traces: string[] = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (option === "--print-selection") {
      if (printSelection) return invalidBundleRequest();
      printSelection = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidBundleRequest();
    if (option === "--root") {
      if (root !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      root = value;
    } else if (option === "--deny-policy") {
      if (denyPolicy !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      denyPolicy = value;
    } else if (option === "--out") {
      if (out !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      out = value;
    } else if (option === "--selection") {
      if (selection !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      selection = value;
    } else if (option === "--review-cache") {
      if (reviewCache !== undefined || !isAbsolutePath(value)) return invalidBundleRequest();
      reviewCache = value;
    } else if (option === "--review-policy") {
      if (reviewPolicy !== undefined || !isReviewPolicy(value)) return invalidBundleRequest();
      reviewPolicy = value;
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
  const review = reviewCache === undefined && reviewPolicy === undefined
    ? undefined
    : reviewCache !== undefined && reviewPolicy !== undefined
      ? { cacheRoot: reviewCache, policy: reviewPolicy }
      : undefined;
  if ((reviewCache === undefined) !== (reviewPolicy === undefined)) return invalidBundleRequest();
  if (printSelection) {
    return root !== undefined && out === undefined && selection === undefined && excludes.length === 0 && traces.length === 0 && review === undefined
      ? { command: "candidate-bundle", ...(denyPolicy === undefined ? {} : { denyPolicy }), mode: "preview", root }
      : invalidBundleRequest();
  }
  if (selection !== undefined) {
    return root !== undefined && out !== undefined && excludes.length === 0 && traces.length === 0 && review === undefined
      ? { command: "candidate-bundle", ...(denyPolicy === undefined ? {} : { denyPolicy }), mode: "selection", out, root, selection }
      : invalidBundleRequest();
  }
  if (root === undefined || out === undefined || (traces.length > 0 && excludes.length > 0)) {
    return invalidBundleRequest();
  }
  return traces.length > 0
    ? {
      command: "candidate-bundle",
      ...(denyPolicy === undefined ? {} : { denyPolicy }),
      mode: "explicit",
      out,
      root,
      traces,
      ...(review === undefined ? {} : { review }),
    }
    : {
      command: "candidate-bundle",
      ...(denyPolicy === undefined ? {} : { denyPolicy }),
      excludes,
      mode: "interactive",
      out,
      root,
      ...(review === undefined ? {} : { review }),
    };
};

export const parseCandidateSearch = (argumentsList: readonly string[]): CandidateCommand => {
  let denyPolicy: string | undefined;
  let query: string | undefined;
  let root: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidCommand();
    if (option === "--root" && root === undefined && isAbsolutePath(value)) root = value;
    else if (option === "--query" && query === undefined && value.length > 0 && value.length <= 256) query = value;
    else if (option === "--deny-policy" && denyPolicy === undefined && isAbsolutePath(value)) denyPolicy = value;
    else return invalidCommand();
    index += 1;
  }
  return root === undefined || query === undefined
    ? invalidCommand()
    : { command: "candidate-search", ...(denyPolicy === undefined ? {} : { denyPolicy }), query, root };
};

export const parseCandidatePublish = (argumentsList: readonly string[]): CandidateCommand => {
  let apiKey: string | undefined;
  let bundle: string | undefined;
  let commercialUse: "yes" | "no" | undefined;
  let consentPolicy: string | undefined;
  let selection: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidCommand();
    if (option === "--bundle" && bundle === undefined && isAbsolutePath(value)) bundle = value;
    else if (option === "--api-key" && apiKey === undefined && value.length > 0) apiKey = value;
    else if (option === "--commercial-use" && commercialUse === undefined && (value === "yes" || value === "no")) commercialUse = value;
    else if (option === "--consent-policy" && consentPolicy === undefined && value.length > 0) consentPolicy = value;
    else if (option === "--selection" && selection === undefined && isAbsolutePath(value)) selection = value;
    else return invalidCommand();
    index += 1;
  }
  if (bundle === undefined || selection === undefined) return invalidCommand();
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(commercialUse === undefined ? {} : { commercialUse }),
    bundle,
    command: "candidate-publish",
    ...(consentPolicy === undefined ? {} : { consentPolicy }),
    selection,
  };
};

export const parseCandidateStatus = (argumentsList: readonly string[]): CandidateCommand => {
  let apiKey: string | undefined;
  let submissionId: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalidCommand();
    if (option === "--submission" && submissionId === undefined) submissionId = value;
    else if (option === "--api-key" && apiKey === undefined && value.length > 0) apiKey = value;
    else return invalidCommand();
    index += 1;
  }
  if (!/^sub_[0-9a-hjkmnp-tv-z]{26}$/.test(submissionId ?? "")) return invalidCommand();
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    command: "candidate-status",
    submissionId: submissionId as string,
  };
};
