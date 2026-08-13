import { describe, expect, test } from "bun:test";

import { parseWorldCommand } from "../../../src/cli/world-command";

const server = "https://registry.example.test";

describe("trajectory world CLI grammar", () => {
  test("parses the exact top-level help spelling", () => {
    // Given: the public command's only help spelling.
    const argumentsList = ["trajectory", "world", "--help"];

    // When: the arguments cross the World parser boundary.
    const result = parseWorldCommand(argumentsList);

    // Then: help needs neither network configuration nor credentials.
    expect(result).toEqual({ command: "world-help" });
  });

  test("parses public catalog and detail requests for the official Registry", () => {
    // Given: canonical public catalog and world-detail invocations.
    const commands = [
      ["world", "list"],
      ["trajectory", "world", "detail", "world-farm"],
    ] as const;

    // When: each request crosses the parser boundary.
    const results = commands.map(parseWorldCommand);

    // Then: dispatch receives only their typed public identities.
    expect(results).toEqual([
      { command: "world-list" },
      { command: "world-detail", worldId: "world-farm" },
    ]);
  });

  test("parses protected hosted and delivery requests with every identity", () => {
    // Given: canonical commands with their registry-authorized identities.
    const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const contractId = "00000000-0000-4000-8000-000000000002";
    const entitlementId = "00000000-0000-4000-8000-000000000001";
    const commands = [
      [
        "world", "run", "world/refund-unit", "--contract-id", contractId,
        "--pack-digest", digest, "--seed", "7", "--idempotency-key", "run-7", "--api-key", "token", "--json",
      ],
      [
        "world", "status", "world/refund-unit", "instance-7f1a9c2e",
        "--contract-id", contractId, "--pack-digest", digest, "--api-key", "token",
      ],
      ["world", "download", entitlementId, "--api-key", "token"],
    ] as const;

    // When: the requests cross the parser boundary.
    const results = commands.map(parseWorldCommand);

    // Then: protected dispatch receives all authorization identities before HTTP.
    expect(results).toEqual([
      {
        apiKey: "token", command: "world-run", contractId, idempotencyKey: "run-7",
        json: true, packDigest: digest, seed: 7, worldId: "world/refund-unit",
      },
      {
        apiKey: "token", command: "world-status", contractId, instanceId: "instance-7f1a9c2e",
        json: false, packDigest: digest, worldId: "world/refund-unit",
      },
      { apiKey: "token", command: "world-download", entitlementId, json: false },
    ]);
  });

  test.each([
    ["server override", ["world", "list", "--server", server]],
    ["missing detail identifier", ["world", "detail"]],
    ["flag-shaped detail identifier", ["world", "detail", "--unknown"]],
    ["unknown option", ["world", "list", "--unknown", "value"]],
    ["trailing public argument", ["world", "list", "extra"]],
    ["extra help argument", ["world", "--help", "--server", server]],
    ["missing hosted contract", ["world", "run", "world/refund-unit", "--pack-digest", "0".repeat(64), "--seed", "7", "--idempotency-key", "run", "--api-key", "token"]],
    ["negative hosted seed", ["world", "run", "world/refund-unit", "--contract-id", "00000000-0000-4000-8000-000000000002", "--pack-digest", "0".repeat(64), "--seed", "-1", "--idempotency-key", "run", "--api-key", "token"]],
    ["duplicate credential", ["world", "download", "00000000-0000-4000-8000-000000000001", "--api-key", "one", "--api-key", "two"]],
    ["missing status digest", ["world", "status", "world/refund-unit", "instance-7f1a9c2e", "--contract-id", "00000000-0000-4000-8000-000000000002", "--api-key", "token"]],
  ] as const)("rejects World grammar: %s", (_case, argumentsList) => {
    // Given: an incomplete, duplicate, or unsupported World command.
    // When: it crosses the parser boundary.
    // Then: no malformed request reaches a transport dispatcher.
    expect(parseWorldCommand(argumentsList)).toEqual({ command: "invalid_world_command" });
  });
});
