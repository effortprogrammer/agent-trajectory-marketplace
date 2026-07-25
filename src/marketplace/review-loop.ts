import { z } from "zod";

import { MarketplaceError } from "./error";
import { fullSelectorSchema, type FrozenTrace, type FullSelector } from "./session-contract";

const commandLineSchema = z.string().trim().min(1);

export type ReviewIO = Readonly<{
  readonly isTTY: boolean;
  readonly write: (line: string) => void;
  readonly readLine: () => Promise<string | undefined>;
}>;

export type ReviewCancellationSignal = Readonly<{
  readonly aborted: boolean;
}>;

export type ReviewRenderer = (trace: FrozenTrace) => string;

export type FrozenReviewInput = Readonly<{
  readonly traces: readonly FrozenTrace[];
  readonly maximumIncludedByteCount: number;
  readonly io: ReviewIO;
  readonly renderInspect: ReviewRenderer;
  readonly cancellation?: ReviewCancellationSignal;
}>;

export type FrozenReviewOutcome =
  | Readonly<{
      readonly kind: "approved";
      readonly traces: readonly FrozenTrace[];
      readonly excludedSelectors: readonly FullSelector[];
      readonly estimatedByteCount: number;
    }>
  | Readonly<{ readonly kind: "aborted" }>
  | Readonly<{ readonly kind: "cancelled" }>
  | Readonly<{ readonly kind: "declined" }>
  | Readonly<{ readonly kind: "eof" }>
  | Readonly<{ readonly kind: "not_tty" }>;

type ReviewState = Readonly<{
  readonly traces: readonly FrozenTrace[];
  readonly excludedSelectors: readonly FullSelector[];
}>;

type ReviewCommand =
  | Readonly<{ readonly kind: "abort" }>
  | Readonly<{ readonly kind: "excluded" }>
  | Readonly<{ readonly kind: "exclude"; readonly selectors: readonly FullSelector[] }>
  | Readonly<{ readonly kind: "included" }>
  | Readonly<{ readonly kind: "inspect"; readonly selector: FullSelector }>
  | Readonly<{ readonly kind: "write" }>;

type ParsedReviewCommand =
  | Readonly<{ readonly kind: "command"; readonly command: ReviewCommand }>
  | Readonly<{ readonly kind: "error"; readonly code: "invalid_review_command" | "invalid_selector" }>;

const assertNever = (value: never): never => {
  throw new MarketplaceError("invalid_review_command");
};

const selectedTraces = (state: ReviewState): readonly FrozenTrace[] =>
  state.traces.filter((trace) => !state.excludedSelectors.includes(trace.selector));

const estimatedByteCount = (traces: readonly FrozenTrace[]): number =>
  traces.reduce((total, trace) => total + trace.byteCount, 0);

const selectorReceipt = (label: "included" | "excluded", selectors: readonly FullSelector[]): string =>
  `${label}: ${selectors.join(" ")}`;

const writeMembershipReceipts = (state: ReviewState, io: ReviewIO): readonly FrozenTrace[] => {
  const included = selectedTraces(state);
  io.write(selectorReceipt("included", included.map((trace) => trace.selector)));
  io.write(selectorReceipt("excluded", state.excludedSelectors));
  return included;
};

const parseSelector = (value: string | undefined): FullSelector | undefined => {
  const parsed = fullSelectorSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const parseReviewCommand = (line: string): ParsedReviewCommand => {
  const parsedLine = commandLineSchema.safeParse(line);
  if (!parsedLine.success) return { kind: "error", code: "invalid_review_command" };
  const tokens = parsedLine.data.split(/\s+/u);
  const commandName = tokens[0];

  switch (commandName) {
    case "inspect": {
      if (tokens.length !== 2) return { kind: "error", code: "invalid_review_command" };
      const selector = parseSelector(tokens[1]);
      return selector === undefined
        ? { kind: "error", code: "invalid_selector" }
        : { kind: "command", command: { kind: "inspect", selector } };
    }
    case "exclude": {
      if (tokens.length < 2) return { kind: "error", code: "invalid_review_command" };
      const selectors = tokens.slice(1).map(parseSelector);
      if (selectors.some((selector) => selector === undefined)) {
        return { kind: "error", code: "invalid_selector" };
      }
      return {
        kind: "command",
        command: { kind: "exclude", selectors: selectors.filter((selector) => selector !== undefined) },
      };
    }
    case "included":
    case "excluded":
    case "write":
    case "abort":
      return tokens.length === 1
        ? { kind: "command", command: { kind: commandName } }
        : { kind: "error", code: "invalid_review_command" };
    default:
      return { kind: "error", code: "invalid_review_command" };
  }
};

const applyExclusion = (
  state: ReviewState,
  selectors: readonly FullSelector[],
): Readonly<{ readonly kind: "updated"; readonly state: ReviewState }> | Readonly<{
  readonly kind: "error";
  readonly code: "missing_selector";
}> => {
  const allSelectorsExist = selectors.every((selector) =>
    state.traces.some((trace) => trace.selector === selector),
  );
  if (!allSelectorsExist) return { kind: "error", code: "missing_selector" };
  const additions = selectors.filter(
    (selector, index) => !state.excludedSelectors.includes(selector) && selectors.indexOf(selector) === index,
  );
  return {
    kind: "updated",
    state: { ...state, excludedSelectors: [...state.excludedSelectors, ...additions] },
  };
};

const isCancelled = (input: FrozenReviewInput): boolean => input.cancellation?.aborted === true;

const confirmWrite = async (
  input: FrozenReviewInput,
  state: ReviewState,
  included: readonly FrozenTrace[],
): Promise<FrozenReviewOutcome> => {
  input.io.write(`estimated_bytes: ${estimatedByteCount(included)}`);
  input.io.write("confirm: type yes");
  if (isCancelled(input)) return { kind: "cancelled" };
  const confirmation = await input.io.readLine();
  if (isCancelled(input)) return { kind: "cancelled" };
  if (confirmation === undefined) return { kind: "eof" };
  if (confirmation === "abort") return { kind: "aborted" };
  if (confirmation !== "yes") return { kind: "declined" };
  return {
    kind: "approved",
    traces: included,
    excludedSelectors: state.excludedSelectors,
    estimatedByteCount: estimatedByteCount(included),
  };
};

export const runFrozenReview = async (input: FrozenReviewInput): Promise<FrozenReviewOutcome> => {
  if (!input.io.isTTY) return { kind: "not_tty" };
  let state: ReviewState = { traces: input.traces, excludedSelectors: [] };

  while (true) {
    if (isCancelled(input)) return { kind: "cancelled" };
    const line = await input.io.readLine();
    if (isCancelled(input)) return { kind: "cancelled" };
    if (line === undefined) return { kind: "eof" };
    const parsed = parseReviewCommand(line);

    switch (parsed.kind) {
      case "error":
        input.io.write(`error: ${parsed.code}`);
        continue;
      case "command":
        break;
      default:
        assertNever(parsed);
    }

    const command = parsed.command;
    switch (command.kind) {
      case "abort":
        return { kind: "aborted" };
      case "excluded":
        input.io.write(selectorReceipt("excluded", state.excludedSelectors));
        continue;
      case "exclude": {
        const excluded = applyExclusion(state, command.selectors);
        if (excluded.kind === "error") {
          input.io.write(`error: ${excluded.code}`);
          continue;
        }
        state = excluded.state;
        writeMembershipReceipts(state, input.io);
        continue;
      }
      case "included":
        input.io.write(selectorReceipt("included", selectedTraces(state).map((trace) => trace.selector)));
        continue;
      case "inspect": {
        const trace = state.traces.find((candidate) => candidate.selector === command.selector);
        if (trace === undefined) {
          input.io.write("error: missing_selector");
          continue;
        }
        input.io.write(input.renderInspect(trace));
        continue;
      }
      case "write": {
        const included = writeMembershipReceipts(state, input.io);
        if (included.length === 0) {
          input.io.write("error: empty_selection");
          continue;
        }
        if (estimatedByteCount(included) > input.maximumIncludedByteCount) {
          input.io.write("error: snapshot_too_large");
          continue;
        }
        return confirmWrite(input, state, included);
      }
      default:
        assertNever(command);
    }
  }
};
