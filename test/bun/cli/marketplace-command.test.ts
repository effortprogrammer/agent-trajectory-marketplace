import { describe, expect, test } from "bun:test";

import {
  parseMarketplaceCommand,
  type MarketplaceCommand,
} from "../../../src/cli/marketplace-command";

const selector = "s-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("trajectory marketplace seller CLI grammar", () => {
  test("parses a sessions list command with an optional executable prefix", () => {
    // Given: a canonical marketplace list invocation.
    const argumentsList = [
      "trajectory",
      "marketplace",
      "seller",
      "sessions",
      "list",
      "--root",
      "/tmp/traces",
      "--json",
    ];

    // When: the arguments cross the marketplace parser boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: the typed local list request preserves its requested output format.
    expect(result).toEqual({ command: "sessions-list", json: true, root: "/tmp/traces" });
  });

  test("parses a sessions inspect command without an executable prefix", () => {
    // Given: executable-relative inspect arguments using a full selector.
    const argumentsList = [
      "marketplace",
      "seller",
      "sessions",
      "inspect",
      selector,
      "--root",
      "/tmp/traces",
    ];

    // When: the arguments cross the marketplace parser boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: the selector and root are available to an inspect dispatcher.
    expect(result).toEqual({ command: "sessions-inspect", json: false, root: "/tmp/traces", selector });
  });

  test("parses interactive candidate bundle options with repeatable exclusions", () => {
    // Given: a local interactive bundle request with two pre-exclusions.
    const argumentsList = [
      "marketplace",
      "seller",
      "candidate",
      "bundle",
      "--root",
      "/tmp/traces",
      "--out",
      "/tmp/candidate.zip",
      "--exclude",
      selector,
      "--exclude",
      "s-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    ];

    // When: the arguments cross the marketplace parser boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: the parser selects interactive review mode without accepting trace inputs.
    expect(result).toEqual({
      command: "candidate-bundle",
      excludes: [
        selector,
        "s-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      ],
      mode: "interactive",
      out: "/tmp/candidate.zip",
      root: "/tmp/traces",
    });
  });

  test("parses explicit candidate bundle options as single repeatable trace values", () => {
    // Given: a non-interactive bundle request with root-relative trace entries.
    const argumentsList = [
      "marketplace",
      "seller",
      "candidate",
      "bundle",
      "--root",
      "/tmp/traces",
      "--out",
      "/tmp/candidate.zip",
      "--trace",
      "nested/one.atf.json",
      "--trace",
      "two.atf.json",
    ];

    // When: the arguments cross the marketplace parser boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: explicit selection mode contains each individual trace value.
    expect(result).toEqual({
      command: "candidate-bundle",
      mode: "explicit",
      out: "/tmp/candidate.zip",
      root: "/tmp/traces",
      traces: ["nested/one.atf.json", "two.atf.json"],
    });
  });

  test("returns invalid command for unsupported marketplace spellings and session syntax", () => {
    // Given: unavailable publication, unknown flags, and malformed inspect requests.
    const invalidArguments = [
      ["marketplace", "seller", "candidate", "publish"],
      ["marketplace", "seller", "candidate", "publish", "--api-key", "secret"],
      ["marketplace", "seller", "sessions", "list", "--root", "/tmp/traces", "--unknown"],
      ["marketplace", "seller", "sessions", "inspect", "s-short", "--root", "/tmp/traces"],
      ["marketplace", "seller", "sessions", "list", "--root", "relative"],
    ];

    // When: each request crosses the marketplace parser boundary.
    const results = invalidArguments.map(parseMarketplaceCommand);

    // Then: no unavailable command or malformed session request reaches a dispatcher.
    expect(results).toEqual([
      { command: "invalid_command" },
      { command: "invalid_command" },
      { command: "invalid_command" },
      { command: "invalid_command" },
      { command: "invalid_command" },
    ]);
  });

  test("returns invalid bundle request for unsafe, ambiguous, and incompatible bundle options", () => {
    // Given: malformed local bundle requests.
    const invalidArguments = [
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--root", "/tmp/again"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "relative", "--out", "/tmp/a.zip"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "relative.zip"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "/outside.atf.json"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "../outside.atf.json"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "trace.json"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "one.atf.json", "--exclude", selector],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "one.atf.json", "two.atf.json"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--exclude", "not-a-selector"],
    ];

    // When: each request crosses the marketplace parser boundary.
    const results = invalidArguments.map(parseMarketplaceCommand);

    // Then: no unsafe or ambiguous request can enter bundle handling.
    expect(results).toEqual(invalidArguments.map(() => ({ command: "invalid_bundle_request" })));
  });

  test("keeps the marketplace parser result discriminated for downstream dispatch", () => {
    // Given: a parsed marketplace request.
    const result: MarketplaceCommand = parseMarketplaceCommand([
      "marketplace",
      "seller",
      "sessions",
      "list",
      "--root",
      "/tmp/traces",
    ]);

    // When: a downstream dispatcher examines its command discriminator.
    const command = result.command;

    // Then: every parser result carries a stable command outcome.
    expect(command).toBe("sessions-list");
  });
});
