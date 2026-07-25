import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const decoder = new TextDecoder();

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-marketplace-cli-"));
  roots.push(root);
  return root;
};

const writeTrace = (root: string, name: string, runtime: string, request: string): void => {
  const events = [
    {
      kind: "function_enter",
      name: "turn",
      payload: { role: "user", content: request },
      sourceEventId: `${name}-request`,
      timestamp: "2026-07-24T09:00:00.000Z",
    },
  ];
  writeFileSync(join(root, name), JSON.stringify({
    runtime,
    status: "collected",
    formatVersion: 2,
    eventCount: events.length,
    events,
  }));
};

const writeEvidenceTrace = (root: string): string => {
  const events = [
    { kind: "session_start", name: "session" },
    { kind: "function_enter", name: "turn", payload: { role: "user", content: "review\u001b[31m this" } },
    { kind: "tool_call", name: "terminal", payload: { input: { command: "bun test" } } },
    { kind: "llm_call", name: "model", payload: { role: "assistant", content: "tests ran" } },
    { kind: "tool_result", name: "terminal", payload: { output: "exit 1", isError: true } },
  ];
  writeFileSync(join(root, "z.atf.json"), JSON.stringify({
    runtime: "codex",
    status: "collected",
    formatVersion: 2,
    eventCount: events.length,
    events,
  }));
  return "s-7303a2074a8304f60e6036ab9b3635aee7705b101f0d4ba68497d60bd46b14d4";
};

const runCli = (argumentsList: readonly string[]) => Bun.spawnSync(
  [process.execPath, "src/cli/index.ts", ...argumentsList],
  { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" },
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("marketplace sessions process boundary", () => {
  test("Given two valid ATFs, When list JSON runs, Then the real CLI returns sorted stored evidence", () => {
    // Given
    const root = fixtureRoot();
    writeTrace(root, "z.atf.json", "codex", "review z");
    writeTrace(root, "a.atf.json", "claude-code", "review a");

    // When
    const result = runCli(["marketplace", "seller", "sessions", "list", "--root", root, "--json"]);

    // Then
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    const output: unknown = JSON.parse(decoder.decode(result.stdout));
    expect(Array.isArray(output)).toBe(true);
    if (!Array.isArray(output)) throw new Error("expected list output");
    expect(output).toHaveLength(2);
    const serialized = output.map((item) => JSON.stringify(item));
    expect(serialized).toContainEqual(expect.stringContaining('"firstRequestExcerpt":"review a"'));
    expect(serialized).toContainEqual(expect.stringContaining('"firstRequestExcerpt":"review z"'));
    const selectors = output.flatMap((item) => {
      if (item === null || typeof item !== "object" || !("selector" in item)) return [];
      return typeof item.selector === "string" ? [item.selector] : [];
    });
    expect(selectors).toEqual(selectors.toSorted());
  });

  test("Given stored work events, When inspect JSON runs with the executable prefix, Then indices and categories are real", () => {
    // Given
    const root = fixtureRoot();
    const selector = writeEvidenceTrace(root);

    // When
    const result = runCli(["trajectory", "marketplace", "seller", "sessions", "inspect", selector, "--root", root, "--json"]);

    // Then
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    const output: unknown = JSON.parse(decoder.decode(result.stdout));
    expect(output).toMatchObject({
      selector,
      requests: [{ kind: "request", eventIndex: 1 }],
      actions: [{ kind: "action", eventIndex: 2 }],
      results: [{ kind: "result", eventIndex: 3 }],
      errors: [{ kind: "error", eventIndex: 4 }],
    });
    expect(decoder.decode(result.stdout)).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
  });

  test("Given hostile stored text, When list uses human output, Then the surface shows safe markers", () => {
    // Given
    const root = fixtureRoot();
    writeEvidenceTrace(root);

    // When
    const result = runCli(["marketplace", "seller", "sessions", "list", "--root", root]);

    // Then
    expect(result.exitCode).toBe(0);
    const output = decoder.decode(result.stdout);
    expect(output).toContain("[control:U+001B]");
    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
  });

  test("Given hostile stored text, When inspect uses human output, Then the surface shows safe markers", () => {
    // Given
    const root = fixtureRoot();
    const selector = writeEvidenceTrace(root);

    // When
    const result = runCli(["marketplace", "seller", "sessions", "inspect", selector, "--root", root]);

    // Then
    expect(result.exitCode).toBe(0);
    const output = decoder.decode(result.stdout);
    expect(output).toContain("[control:U+001B]");
    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
  });

  test("Given invalid inputs, When each real CLI process runs, Then stderr has only its stable JSON code", () => {
    // Given
    const root = fixtureRoot();
    const validRoot = fixtureRoot();
    writeFileSync(join(root, "bad.atf.json"), "{");
    writeTrace(validRoot, "valid.atf.json", "codex", "safe");
    const cases = [
      { argumentsList: ["marketplace", "seller", "sessions", "list", "--root", "../escape", "--json"], code: "invalid_command" },
      { argumentsList: ["marketplace", "seller", "sessions", "list", "--root", join(root, "missing"), "--json"], code: "invalid_root" },
      { argumentsList: ["marketplace", "seller", "sessions", "list", "--root", root, "--json"], code: "invalid_trace" },
      { argumentsList: ["marketplace", "seller", "sessions", "inspect", "s-short", "--root", root, "--json"], code: "invalid_command" },
      { argumentsList: ["marketplace", "seller", "sessions", "inspect", `s-${"a".repeat(64)}`, "--root", validRoot, "--json"], code: "missing_selector" },
    ] as const;

    // When
    const results = cases.map(({ argumentsList }) => runCli(argumentsList));

    // Then
    expect(results.map((result) => result.exitCode)).toEqual([1, 1, 1, 1, 1]);
    expect(results.map((result) => decoder.decode(result.stdout))).toEqual(["", "", "", "", ""]);
    expect(results.map((result) => decoder.decode(result.stderr))).toEqual(
      cases.map(({ code }) => `${JSON.stringify({ error: code })}\n`),
    );
  });
});
