import { describe, expect, test } from "bun:test";

const decoder = new TextDecoder();

const runCli = (argumentsList: readonly string[]) => Bun.spawnSync(
  [process.execPath, "src/cli/index.ts", ...argumentsList],
  { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" },
);

describe("World CLI dispatch routing", () => {
  test("routes World help before collector parsing", () => {
    // Given: the top-level World help invocation.
    const argumentsList = ["world", "--help"];

    // When: the real CLI process dispatches it.
    const result = runCli(argumentsList);

    // Then: help succeeds without falling into the collector grammar.
    expect({
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
    }).toEqual({ exitCode: 0, stderr: "" });
  });

  test("preserves auth marketplace update and collector routes", () => {
    // Given: representative invocations owned by existing top-level routes.
    const results = [
      runCli(["auth"]),
      runCli(["marketplace"]),
      runCli(["update", "status"]),
      runCli(["runtimes"]),
    ];

    // When: all commands traverse the shared CLI dispatcher.
    const observed = results.map((result) => ({
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
      stdout: decoder.decode(result.stdout),
    }));

    // Then: their existing router-specific outcomes remain unchanged.
    expect(observed.slice(0, 3)).toEqual([
      { exitCode: 1, stderr: '{"error":"invalid_auth_command"}\n', stdout: "" },
      { exitCode: 1, stderr: '{"error":"invalid_command"}\n', stdout: "" },
      { exitCode: 1, stderr: '{"error":"invalid_collector_request"}\n', stdout: "" },
    ]);
    expect(observed[3].exitCode).toBe(0);
    expect(observed[3].stderr).toBe("");
    const runtimes: unknown = JSON.parse(observed[3].stdout);
    const runtimeCount = Array.isArray(runtimes) ? runtimes.length : 0;
    expect(runtimeCount).toBeGreaterThan(0);
  });
});
