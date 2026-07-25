import { describe, expect, test } from "bun:test";

import {
  runFrozenReview,
  type ReviewCancellationSignal,
  type ReviewIO,
} from "../../../src/marketplace/review-loop";
import {
  fullSelectorSchema,
  traceHashSchema,
  type FrozenTrace,
} from "../../../src/marketplace/session-contract";

const firstHash = "a".repeat(64);
const secondHash = "b".repeat(64);
const thirdHash = "c".repeat(64);
const firstSelector = `s-${firstHash}`;
const secondSelector = `s-${secondHash}`;
const thirdSelector = `s-${thirdHash}`;

class ScriptedReviewIO implements ReviewIO {
  readonly writes: string[] = [];
  #index = 0;

  constructor(
    readonly lines: readonly (string | undefined)[],
    readonly isTTY = true,
  ) {}

  write(line: string): void {
    this.writes.push(line);
  }

  async readLine(): Promise<string | undefined> {
    const line = this.lines.at(this.#index);
    this.#index += 1;
    return line;
  }
}

const trace = (hash: string, byteCount: number): FrozenTrace => ({
  selector: fullSelectorSchema.parse(`s-${hash}`),
  relativePath: `traces/${hash}.atf.json`,
  hash: traceHashSchema.parse(hash),
  byteCount,
  runtime: "test",
  eventCount: 0,
  earliestTimestamp: "unknown",
  bytes: new Uint8Array(byteCount),
});

const firstTrace = trace(firstHash, 2);
const secondTrace = trace(secondHash, 3);
const thirdTrace = trace(thirdHash, 5);

const run = (
  io: ScriptedReviewIO,
  options: Readonly<{
    readonly traces?: readonly FrozenTrace[];
    readonly maximumIncludedByteCount?: number;
    readonly cancellation?: ReviewCancellationSignal;
    readonly renderInspect?: (frozenTrace: FrozenTrace) => string;
  }> = {},
) =>
  runFrozenReview({
    io,
    traces: options.traces ?? [firstTrace, secondTrace],
    maximumIncludedByteCount: options.maximumIncludedByteCount ?? 10,
    cancellation: options.cancellation,
    renderInspect: options.renderInspect ?? ((frozenTrace) => `inspect:${frozenTrace.selector}:${frozenTrace.bytes.byteLength}`),
  });

describe("frozen candidate bundle review", () => {
  test("approves only the non-excluded frozen trace after inspect, exclude, receipts, and yes", async () => {
    // Given: a TTY review with two fixed traces and an inert in-memory renderer.
    const io = new ScriptedReviewIO([
      `inspect ${firstSelector}`,
      `exclude ${secondSelector}`,
      "included",
      "excluded",
      "write",
      "yes",
    ]);

    // When: the operator reviews then confirms the frozen membership.
    const outcome = await run(io, { renderInspect: () => "write" });

    // Then: approval contains only the retained object and exact selector/byte receipts were printed.
    expect(outcome).toEqual({
      kind: "approved",
      traces: [firstTrace],
      excludedSelectors: [fullSelectorSchema.parse(secondSelector)],
      estimatedByteCount: 2,
    });
    expect(io.writes).toEqual([
      "write",
      `included: ${firstSelector}`,
      `excluded: ${secondSelector}`,
      `included: ${firstSelector}`,
      `excluded: ${secondSelector}`,
      `included: ${firstSelector}`,
      `excluded: ${secondSelector}`,
      "estimated_bytes: 2",
      "confirm: type yes",
    ]);
  });

  test("makes repeated exclusions idempotent", async () => {
    // Given: a selected trace that is named by two separate exclude commands.
    const io = new ScriptedReviewIO([`exclude ${secondSelector}`, `exclude ${secondSelector}`, "write", "yes"]);

    // When: the review consumes both exclusions.
    const outcome = await run(io);

    // Then: the selector appears once and the remaining bytes are unchanged.
    expect(outcome).toEqual({
      kind: "approved",
      traces: [firstTrace],
      excludedSelectors: [fullSelectorSchema.parse(secondSelector)],
      estimatedByteCount: 2,
    });
  });

  test("keeps a multi-exclusion atomic when one selector is absent", async () => {
    // Given: one known and one syntactically valid but absent full selector.
    const io = new ScriptedReviewIO([
      `exclude ${firstSelector} ${thirdSelector}`,
      "included",
      "abort",
    ]);

    // When: the incomplete multi-selector exclusion is entered.
    const outcome = await run(io);

    // Then: the review reports the recoverable selector error and retains all membership.
    expect(outcome).toEqual({ kind: "aborted" });
    expect(io.writes).toEqual(["error: missing_selector", `included: ${firstSelector} ${secondSelector}`]);
  });

  test("recovers from malformed commands and selectors without interpreting rendered text", async () => {
    // Given: malformed input followed by a renderer result that resembles a command.
    const io = new ScriptedReviewIO(["include", "inspect s-short", `inspect ${firstSelector}`, "abort"]);

    // When: the loop processes the invalid lines then a valid inspection.
    const outcome = await run(io);

    // Then: stable errors are printed, the renderer text is only output, and the loop continues.
    expect(outcome).toEqual({ kind: "aborted" });
    expect(io.writes).toEqual([
      "error: invalid_review_command",
      "error: invalid_selector",
      `inspect:${firstSelector}:2`,
    ]);
  });

  test("keeps reviewing when a valid stale selector is absent from the frozen snapshot", async () => {
    // Given: a selector valid for a different snapshot but absent from this frozen input.
    const io = new ScriptedReviewIO([`inspect ${thirdSelector}`, "abort"]);

    // When: inspection is requested using that stale selector.
    const outcome = await run(io);

    // Then: the local review reports a recoverable missing selector and does not render anything.
    expect(outcome).toEqual({ kind: "aborted" });
    expect(io.writes).toEqual(["error: missing_selector"]);
  });

  test("rejects write approval while membership is empty and remains reviewable", async () => {
    // Given: a review whose every frozen trace is excluded.
    const io = new ScriptedReviewIO([`exclude ${firstSelector} ${secondSelector}`, "write", "abort"]);

    // When: the operator asks to write the empty selection.
    const outcome = await run(io);

    // Then: it reports the stable gate and never requests confirmation.
    expect(outcome).toEqual({ kind: "aborted" });
    expect(io.writes).toEqual([
      "included: ",
      `excluded: ${firstSelector} ${secondSelector}`,
      "included: ",
      `excluded: ${firstSelector} ${secondSelector}`,
      "error: empty_selection",
    ]);
  });

  test("rejects write approval over the byte cap and remains reviewable", async () => {
    // Given: an included frozen set above a deliberately small cap.
    const io = new ScriptedReviewIO(["write", "abort"]);

    // When: the operator asks to write it.
    const outcome = await run(io, { maximumIncludedByteCount: 4 });

    // Then: the stable cap error is output before any confirmation read.
    expect(outcome).toEqual({ kind: "aborted" });
    expect(io.writes).toEqual([
      `included: ${firstSelector} ${secondSelector}`,
      "excluded: ",
      "error: snapshot_too_large",
    ]);
  });

  test("returns a non-write decline outcome unless confirmation is literal yes", async () => {
    // Given: an otherwise valid write review answered with a non-literal confirmation.
    const io = new ScriptedReviewIO(["write", "Yes"]);

    // When: the confirmation is evaluated.
    const outcome = await run(io);

    // Then: no approved selection is produced.
    expect(outcome).toEqual({ kind: "declined" });
  });

  test("returns a non-write EOF outcome before a command and during confirmation", async () => {
    // Given: independent scripts ending before a command and before confirmation respectively.
    const commandEof = new ScriptedReviewIO([]);
    const confirmationEof = new ScriptedReviewIO(["write"]);

    // When: each review consumes its available input.
    const commandOutcome = await run(commandEof);
    const confirmationOutcome = await run(confirmationEof);

    // Then: both exit without approval and the confirmation receipt remains observable.
    expect(commandOutcome).toEqual({ kind: "eof" });
    expect(confirmationOutcome).toEqual({ kind: "eof" });
    expect(confirmationEof.writes).toEqual([
      `included: ${firstSelector} ${secondSelector}`,
      "excluded: ",
      "estimated_bytes: 5",
      "confirm: type yes",
    ]);
  });

  test("returns a non-write cancellation outcome and a fresh review can resume", async () => {
    // Given: a cancellation signal that is initially raised, followed by a separate fresh review.
    const cancelled: ReviewCancellationSignal = { aborted: true };
    const cancelledIo = new ScriptedReviewIO(["write", "yes"]);
    const resumedIo = new ScriptedReviewIO(["write", "yes"]);

    // When: the cancelled review and then the fresh review are run.
    const cancelledOutcome = await run(cancelledIo, { cancellation: cancelled });
    const resumedOutcome = await run(resumedIo);

    // Then: interruption is non-write and does not contaminate a subsequent frozen review.
    expect(cancelledOutcome).toEqual({ kind: "cancelled" });
    expect(resumedOutcome).toEqual({
      kind: "approved",
      traces: [firstTrace, secondTrace],
      excludedSelectors: [],
      estimatedByteCount: 5,
    });
  });

  test("returns an abort outcome without confirmation or approval", async () => {
    // Given: a TTY operator that immediately aborts a review.
    const io = new ScriptedReviewIO(["abort"]);

    // When: the abort command is read.
    const outcome = await run(io);

    // Then: the outcome contains no frozen trace membership to write.
    expect(outcome).toEqual({ kind: "aborted" });
    expect(io.writes).toEqual([]);
  });

  test("returns an abort outcome when abort is entered at confirmation", async () => {
    // Given: a valid frozen write review whose confirmation line is abort.
    const io = new ScriptedReviewIO(["write", "abort"]);

    // When: the confirmation is read.
    const outcome = await run(io);

    // Then: the confirmation path produces no approved membership.
    expect(outcome).toEqual({ kind: "aborted" });
  });

  test("does not start an interactive review for a non-TTY IO", async () => {
    // Given: an injected review IO that is not interactive.
    const io = new ScriptedReviewIO(["write", "yes"], false);

    // When: the frozen review is requested.
    const outcome = await run(io);

    // Then: it returns a non-write outcome without consuming or emitting a command.
    expect(outcome).toEqual({ kind: "not_tty" });
    expect(io.writes).toEqual([]);
  });
});
