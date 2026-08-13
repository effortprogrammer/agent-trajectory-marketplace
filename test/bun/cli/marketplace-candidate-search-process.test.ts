import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const decoder = new TextDecoder();

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-deny-search-cli-"));
  roots.push(root);
  return root;
};

const selectorFor = (relativePath: string): string =>
  `s-${createHash("sha256").update(relativePath).digest("hex")}`;

const traceBytes = (events: readonly unknown[]): Uint8Array => new TextEncoder().encode(JSON.stringify({
  eventCount: events.length,
  events,
  formatVersion: 2,
  runtime: "codex",
  status: "collected",
}));

const userTraceBytes = (content: string): Uint8Array => traceBytes([
  { kind: "function_enter", name: "turn", payload: { content, role: "user" } },
]);

const runCli = (argumentsList: readonly string[]) => Bun.spawnSync(
  [process.execPath, "src/cli/index.ts", ...argumentsList],
  { cwd: process.cwd(), stderr: "pipe", stdin: "ignore", stdout: "pipe" },
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("marketplace candidate deny policy and sanitized search process boundary", () => {
  test("Given a bounded deny policy, When preview and search run, Then denied candidates stay out and selector/count output is stable", () => {
    // Given: one allowed candidate and one candidate matching a user policy pattern.
    const root = fixtureRoot();
    writeFileSync(join(root, "allowed.atf.json"), userTraceBytes("visible safe work"));
    writeFileSync(join(root, "denied.atf.json"), userTraceBytes("visible exclude-this work"));
    const policy = join(root, "deny-policy.json");
    writeFileSync(policy, JSON.stringify({ patterns: ["exclude-this"], schemaVersion: 1 }));

    // When: safe search and selection preview receive the same policy.
    const search = runCli([
      "marketplace", "seller", "candidate", "search",
      "--root", root, "--query", "visible", "--deny-policy", policy,
    ]);
    const preview = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection", "--deny-policy", policy,
    ]);

    // Then: both use the same policy-filtered membership and search emits opaque stable output only.
    expect(search.exitCode).toBe(0);
    expect(decoder.decode(search.stderr)).toBe("");
    expect(JSON.parse(decoder.decode(search.stdout))).toEqual({
      count: 1,
      selectors: [selectorFor("allowed.atf.json")],
    });
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(preview.stdout)).traces.map((trace: { selector: string }) => trace.selector)).toEqual([
      selectorFor("allowed.atf.json"),
    ]);
  });

  test("Given sanitized candidate content, When a query has no match, Then the stable empty result leaks no candidate text", () => {
    // Given: a credential-shaped native value which is redacted before candidate reporting.
    const root = fixtureRoot();
    const secret = "never-print-this-token";
    writeFileSync(join(root, "secret.atf.json"), userTraceBytes(`api_key=${secret}`));

    // When: the raw secret is searched and a safe marker is searched.
    const noMatch = runCli([
      "marketplace", "seller", "candidate", "search", "--root", root, "--query", secret,
    ]);
    const redacted = runCli([
      "marketplace", "seller", "candidate", "search", "--root", root, "--query", "redacted",
    ]);

    // Then: no-match is stable, and a hit still emits only selector/count receipts rather than source content.
    expect(noMatch.exitCode).toBe(0);
    expect(decoder.decode(noMatch.stdout)).toBe('{"count":0,"selectors":[]}\n');
    expect(redacted.exitCode).toBe(0);
    expect(decoder.decode(redacted.stdout)).toBe(JSON.stringify({
      count: 1,
      selectors: [selectorFor("secret.atf.json")],
    }) + "\n");
    expect(decoder.decode(redacted.stdout)).not.toContain(secret);
    expect(decoder.decode(redacted.stdout)).not.toContain("api_key");
  });

  test("Given assistant-only sanitized content, When preview and deny policy run, Then the assistant result cannot bypass denial", () => {
    // Given: the denied text appears only in an assistant result, outside the historical request summary.
    const root = fixtureRoot();
    writeFileSync(join(root, "allowed.atf.json"), userTraceBytes("visible"));
    writeFileSync(join(root, "assistant.atf.json"), traceBytes([
      { kind: "llm_call", name: "model", payload: { content: "assistant-only-deny", role: "assistant" } },
    ]));
    const policy = join(root, "deny-policy.json");
    writeFileSync(policy, JSON.stringify({ patterns: ["assistant-only-deny"], schemaVersion: 1 }));

    // When: preview and search apply the same deny policy.
    const preview = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection", "--deny-policy", policy,
    ]);
    const search = runCli([
      "marketplace", "seller", "candidate", "search",
      "--root", root, "--query", "assistant-only-deny", "--deny-policy", policy,
    ]);

    // Then: neither surface can admit the assistant-only denied candidate.
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(preview.stdout)).traces.map((trace: { selector: string }) => trace.selector)).toEqual([
      selectorFor("allowed.atf.json"),
    ]);
    expect(search.exitCode).toBe(0);
    expect(decoder.decode(search.stdout)).toBe('{"count":0,"selectors":[]}\n');
  });

  test("Given successful tool-result-only sanitized content, When searched, Then it is found", () => {
    // Given: the searchable text exists only in a non-error tool result.
    const root = fixtureRoot();
    writeFileSync(join(root, "result.atf.json"), traceBytes([
      { kind: "tool_result", name: "terminal", payload: { isError: false, output: "tool-result-only-hit" } },
    ]));

    // When: search crosses the real CLI boundary.
    const result = runCli([
      "marketplace", "seller", "candidate", "search",
      "--root", root, "--query", "tool-result-only-hit",
    ]);

    // Then: successful tool output is searchable without exposing it in output.
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toBe(JSON.stringify({
      count: 1,
      selectors: [selectorFor("result.atf.json")],
    }) + "\n");
  });

  test("Given NFC sanitized content, When an NFD query and policy are used, Then matching is canonical-equivalent", () => {
    // Given: the uploadable sanitized trace holds precomposed text while external input is decomposed.
    const root = fixtureRoot();
    writeFileSync(join(root, "unicode.atf.json"), userTraceBytes("CAFÉ searchable"));
    const policy = join(root, "deny-policy.json");
    writeFileSync(policy, JSON.stringify({ patterns: ["cafe\u0301"], schemaVersion: 1 }));

    // When: a decomposed query and matching policy pass through the CLI.
    const unfiltered = runCli([
      "marketplace", "seller", "candidate", "search", "--root", root, "--query", "cafe\u0301",
    ]);
    const filtered = runCli([
      "marketplace", "seller", "candidate", "search", "--root", root, "--query", "cafe\u0301", "--deny-policy", policy,
    ]);

    // Then: query matching succeeds and deny matching applies to the same normalized projection.
    expect(unfiltered.exitCode).toBe(0);
    expect(decoder.decode(unfiltered.stdout)).toBe(JSON.stringify({
      count: 1,
      selectors: [selectorFor("unicode.atf.json")],
    }) + "\n");
    expect(filtered.exitCode).toBe(0);
    expect(decoder.decode(filtered.stdout)).toBe('{"count":0,"selectors":[]}\n');
  });

  test("Given malformed policy bytes, When search crosses the CLI boundary, Then it fails closed without output", () => {
    // Given: a policy document with an unrecognized field.
    const root = fixtureRoot();
    writeFileSync(join(root, "session.atf.json"), userTraceBytes("visible"));
    const policy = join(root, "deny-policy.json");
    writeFileSync(policy, JSON.stringify({ patterns: ["visible"], schemaVersion: 1, unexpected: true }));

    // When: candidate search reads the policy.
    const result = runCli([
      "marketplace", "seller", "candidate", "search",
      "--root", root, "--query", "visible", "--deny-policy", policy,
    ]);

    // Then: malformed policy bytes cannot silently weaken matching or produce partial output.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stdout)).toBe("");
    expect(decoder.decode(result.stderr)).toBe('{"error":"invalid_deny_policy"}\n');
  });

  test("Given a policy above its pattern bound, When search reads it, Then it fails closed", () => {
    // Given: more user patterns than the bounded local policy permits.
    const root = fixtureRoot();
    writeFileSync(join(root, "session.atf.json"), userTraceBytes("visible"));
    const policy = join(root, "deny-policy.json");
    writeFileSync(policy, JSON.stringify({
      patterns: Array.from({ length: 33 }, (_, index) => `pattern-${index}`),
      schemaVersion: 1,
    }));

    // When: the policy is applied to candidate search.
    const result = runCli([
      "marketplace", "seller", "candidate", "search",
      "--root", root, "--query", "visible", "--deny-policy", policy,
    ]);

    // Then: an oversized policy cannot consume unbounded matching work.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stdout)).toBe("");
    expect(decoder.decode(result.stderr)).toBe('{"error":"invalid_deny_policy"}\n');
  });

  test("Given an edited selection that reintroduces a denied selector, When bundle revalidates its policy, Then no archive is written", () => {
    // Given: a deny-filtered preview plus an unfiltered copy from which an editor re-adds the denied entry.
    const root = fixtureRoot();
    writeFileSync(join(root, "allowed.atf.json"), userTraceBytes("allowed"));
    writeFileSync(join(root, "denied.atf.json"), traceBytes([
      { kind: "llm_call", name: "model", payload: { content: "must-not-upload", role: "assistant" } },
    ]));
    const policy = join(root, "deny-policy.json");
    writeFileSync(policy, JSON.stringify({ patterns: ["must-not-upload"], schemaVersion: 1 }));
    const filtered = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection", "--deny-policy", policy,
    ]);
    const all = runCli([
      "marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection",
    ]);
    const edited = JSON.parse(decoder.decode(filtered.stdout));
    const denied = JSON.parse(decoder.decode(all.stdout)).traces.find((trace: { selector: string }) =>
      trace.selector === selectorFor("denied.atf.json"));
    if (denied === undefined) throw new Error("missing denied selection entry");
    denied.summary.requests = ["allowed"];
    edited.traces.push(denied);
    const selection = join(root, "selection.json");
    const output = join(root, "candidate.zip");
    writeFileSync(selection, JSON.stringify(edited));

    // When: construction is asked to use the policy again.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output,
      "--selection", selection, "--deny-policy", policy,
    ]);

    // Then: content/hash/artifact-bound edited membership cannot override the active deny policy, even with forged display summary text.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe('{"error":"denied_selection"}\n');
    expect(existsSync(output)).toBe(false);
  });
});
