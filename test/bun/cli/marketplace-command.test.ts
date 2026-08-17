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

  test("parses an agent-readable sessions choose preview", () => {
    const result = parseMarketplaceCommand([
      "marketplace",
      "seller",
      "sessions",
      "choose",
      "--root",
      "/tmp/traces",
      "--json",
    ]);

    expect(result).toEqual({
      command: "sessions-choose",
      json: true,
      mode: "preview",
      root: "/tmp/traces",
    });
  });

  test("parses hash-bound approvals for a sessions choose document", () => {
    const secondSelector = "s-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    const result = parseMarketplaceCommand([
      "marketplace",
      "seller",
      "sessions",
      "choose",
      "--root",
      "/tmp/traces",
      "--out",
      "/tmp/selection.json",
      "--approve",
      `${selector}@${firstHash}`,
      "--approve",
      `${secondSelector}@${secondHash}`,
    ]);

    expect(result).toEqual({
      command: "sessions-choose",
      approvals: [
        { selector, sha256: firstHash },
        { selector: secondSelector, sha256: secondHash },
      ],
      mode: "write",
      out: "/tmp/selection.json",
      root: "/tmp/traces",
    });
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

  test("parses candidate search with an optional bounded-policy file", () => {
    // Given: a search query over a canonical absolute session root and policy file.
    const argumentsList = [
      "marketplace", "seller", "candidate", "search",
      "--root", "/tmp/traces", "--query", "safe text", "--deny-policy", "/tmp/deny-policy.json",
    ];

    // When: the arguments cross the marketplace parser boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: dispatch receives a typed search request without accepting ambiguous flag forms.
    expect(result).toEqual({
      command: "candidate-search",
      denyPolicy: "/tmp/deny-policy.json",
      query: "safe text",
      root: "/tmp/traces",
    });
  });

  test("parses a paired private review cache and bounded policy only for candidate bundle review", () => {
    // Given: an explicit bundle request with a private cache location and resolved policy revision.
    const argumentsList = [
      "marketplace", "seller", "candidate", "bundle",
      "--root", "/tmp/traces", "--out", "/tmp/candidate.zip", "--trace", "one.atf.json",
      "--review-cache", "/tmp/private-review-cache", "--review-policy", "policy-v1",
    ];

    // When: the options cross the CLI grammar boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: dispatch receives a complete, private review-cache configuration.
    expect(result).toEqual({
      command: "candidate-bundle",
      mode: "explicit",
      out: "/tmp/candidate.zip",
      review: { cacheRoot: "/tmp/private-review-cache", policy: "policy-v1" },
      root: "/tmp/traces",
      traces: ["one.atf.json"],
    });
  });

  test("parses the only candidate publication spelling", () => {
    // Given: an explicit publish request with each supported option exactly once.
    const argumentsList = [
      "trajectory", "marketplace", "seller", "candidate", "publish",
      "--bundle", "/tmp/candidate.zip", "--api-key", "flag-value",
    ];

    // When: the arguments cross the marketplace parser boundary.
    const result = parseMarketplaceCommand(argumentsList);

    // Then: dispatch receives only the typed local request.
    expect(result).toEqual({
      apiKey: "flag-value",
      bundle: "/tmp/candidate.zip",
      command: "candidate-publish",
    });
  });

  test("returns invalid command for unsupported marketplace spellings and session syntax", () => {
    // Given: unknown flags, duplicate publication options, and malformed inspect requests.
    const invalidArguments = [
      ["marketplace", "seller", "candidate", "search", "--root", "/tmp/traces"],
      ["marketplace", "seller", "candidate", "search", "--root", "relative", "--query", "text"],
      ["marketplace", "seller", "candidate", "search", "--root", "/tmp/traces", "--query", "text", "--query", "again"],
      ["marketplace", "seller", "candidate", "publish"],
      ["marketplace", "seller", "candidate", "publish", "--bundle", "relative.zip"],
      ["marketplace", "seller", "candidate", "publish", "--bundle", "/tmp/a.zip", "--server", "https://registry.example.test"],
      ["marketplace", "seller", "candidate", "publish", "--bundle", "/tmp/a.zip", "--unknown", "value"],
      ["marketplace", "seller", "sessions", "list", "--root", "/tmp/traces", "--unknown"],
      ["marketplace", "seller", "sessions", "inspect", "s-short", "--root", "/tmp/traces"],
      ["marketplace", "seller", "sessions", "list", "--root", "relative"],
    ];

    // When: each request crosses the marketplace parser boundary.
    const results = invalidArguments.map(parseMarketplaceCommand);

    // Then: no unavailable command or malformed session request reaches a dispatcher.
    expect(results).toEqual(invalidArguments.map(() => ({ command: "invalid_command" })));
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
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "one.atf.json", "--review-cache", "/tmp/private-review-cache"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "one.atf.json", "--review-policy", "policy-v1"],
      ["marketplace", "seller", "candidate", "bundle", "--root", "/tmp/traces", "--out", "/tmp/a.zip", "--trace", "one.atf.json", "--review-cache", "/tmp/private-review-cache", "--review-policy", " policy-v1"],
    ];

    // When: each request crosses the marketplace parser boundary.
    const results = invalidArguments.map(parseMarketplaceCommand);

    // Then: no unsafe or ambiguous request can enter bundle handling.
    expect(results).toEqual(invalidArguments.map(() => ({ command: "invalid_bundle_request" })));
  });

  test("parses wallet balance commands with an optional explicit api key", () => {
    // Given: canonical wallet balance invocations with and without the credential flag.
    const plain = parseMarketplaceCommand(["marketplace", "seller", "wallet", "balance"]);
    const keyed = parseMarketplaceCommand(["trajectory", "marketplace", "seller", "wallet", "balance", "--api-key", "sentinel"]);

    // When: the arguments cross the parser boundary.
    // Then: the typed wallet request preserves key selection.
    expect(plain).toEqual({ apiKey: undefined, command: "wallet-balance" });
    expect(keyed).toEqual({ apiKey: "sentinel", command: "wallet-balance" });
  });

  test("parses candidate status without a registry override", () => {
    expect(
      parseMarketplaceCommand([
        "marketplace",
        "seller",
        "candidate",
        "status",
        "--submission",
        "sub_00000000000000000000000000",
      ]),
    ).toEqual({
      command: "candidate-status",
      submissionId: "sub_00000000000000000000000000",
    });
  });

  test.each([
    ["server override", ["marketplace", "seller", "wallet", "balance", "--server", "https://registry.example.com"]],
    ["missing api key value", ["marketplace", "seller", "wallet", "balance", "--api-key"]],
    ["flag-shaped api key", ["marketplace", "seller", "wallet", "balance", "--api-key", "--server"]],
    ["trailing argument", ["marketplace", "seller", "wallet", "balance", "extra"]],
    ["unknown flag", ["marketplace", "seller", "wallet", "balance", "--token", "x"]],
    ["joined spelling", ["marketplace", "seller", "wallet-balance"]],
  ] as const)("rejects wallet grammar: %s", (_case, argumentsList) => {
    // Given: a malformed wallet invocation.
    // When: the arguments cross the parser boundary.
    // Then: only the canonical spelling is accepted.
    expect(parseMarketplaceCommand(argumentsList)).toEqual({ command: "invalid_command" });
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
