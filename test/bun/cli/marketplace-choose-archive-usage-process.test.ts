import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officialGatewayProcessArguments, officialGatewayProcessEnvironment } from "../fixtures/gateway-process";

const roots: string[] = [];
const decoder = new TextDecoder();

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-choose-usage-cli-"));
  roots.push(root);
  return root;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const selectorFor = (relativePath: string): string =>
  `s-${createHash("sha256").update(relativePath).digest("hex")}`;
const approvalFor = (relativePath: string, bytes: Uint8Array): string =>
  `${selectorFor(relativePath)}@${sha256(bytes)}`;

const runCli = (argumentsList: readonly string[]) => {
  const invocation = officialGatewayProcessArguments(
    [process.execPath, "src/cli/index.ts", ...argumentsList],
  );
  return Bun.spawnSync(invocation.argumentsList, {
    cwd: process.cwd(),
    env: { ...process.env, ...officialGatewayProcessEnvironment(invocation.target) },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
};

type TraceUsage = Readonly<{
  inputTokens: number;
  latencyMs?: number;
  model: string;
  outputTokens: number;
}>;

const traceBytes = (request: string, usage: TraceUsage): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({
    runtime: "codex",
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [{
      kind: "function_enter",
      name: "turn",
      timestamp: "2026-09-01T00:00:00.000Z",
      sourceEventId: "usage-0",
      payload: { role: "user", content: request, usage },
    }],
  }));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("marketplace sessions choose archive-wide usage boundary", () => {
  test("Given a positive-usage session and a latency-only companion, When choose writes, Then the archive-wide invariant admits both", () => {
    // Given: one session with positive source-attested compensated usage and one
    // standalone latency-only companion whose usage carries no positive tokens.
    const root = fixtureRoot();
    const compensated = traceBytes("first", {
      inputTokens: 1, model: "claude-fable-5", outputTokens: 1,
    });
    const latencyOnly = traceBytes("latency probe", {
      inputTokens: 0, latencyMs: 42, model: "claude-fable-5", outputTokens: 0,
    });
    writeFileSync(join(root, "a.atf.json"), compensated);
    writeFileSync(join(root, "latency.atf.json"), latencyOnly);
    const selectionPath = join(root, "selection.json");

    // When: both sessions are approved into a single selection.
    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("a.atf.json", compensated),
      "--approve", approvalFor("latency.atf.json", latencyOnly),
    ]);

    // Then: the selection is written with both traces because positive usage is
    // required of the archive, not of each trace individually.
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    const written = JSON.parse(readFileSync(selectionPath, "utf8"));
    expect(written.traces.map((trace: { selector: string }) => trace.selector).sort()).toEqual(
      [selectorFor("a.atf.json"), selectorFor("latency.atf.json")].sort(),
    );
  });

  test("Given latency-only sessions, When choose writes, Then it rejects the membership without output", () => {
    // Given: a selection with no source-attested positive compensated usage.
    const root = fixtureRoot();
    const latencyOnly = traceBytes("latency probe", {
      inputTokens: 0, latencyMs: 42, model: "runtime-only", outputTokens: 0,
    });
    writeFileSync(join(root, "latency.atf.json"), latencyOnly);
    const selectionPath = join(root, "selection.json");

    // When: the latency-only session is the whole selected membership.
    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("latency.atf.json", latencyOnly),
    ]);

    // Then: local selection rejects the incomplete archive before writing output.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("denied_selection");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given an unsupported positive-usage session, When choose writes, Then it remains blocked", () => {
    // Given: a trace with positive usage attributed to an unsupported model.
    const root = fixtureRoot();
    const unsupported = traceBytes("unsupported", {
      inputTokens: 1, model: "runtime-only", outputTokens: 1,
    });
    writeFileSync(join(root, "unsupported.atf.json"), unsupported);
    const selectionPath = join(root, "selection.json");

    // When: the blocked trace is approved for selection.
    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("unsupported.atf.json", unsupported),
    ]);

    // Then: per-trace admission keeps unsupported positive usage out of output.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("denied_selection");
    expect(existsSync(selectionPath)).toBe(false);
  });
});
