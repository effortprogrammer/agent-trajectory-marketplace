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

const traceBytes = (content: string): Uint8Array => new TextEncoder().encode(JSON.stringify({
  eventCount: 1,
  events: [{ kind: "function_enter", name: "turn", payload: { content, role: "user" } }],
  formatVersion: 2,
  runtime: "codex",
  status: "collected",
}));

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
    writeFileSync(join(root, "allowed.atf.json"), traceBytes("visible safe work"));
    writeFileSync(join(root, "denied.atf.json"), traceBytes("visible exclude-this work"));
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
    writeFileSync(join(root, "secret.atf.json"), traceBytes(`api_key=${secret}`));

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

  test("Given malformed policy bytes, When search crosses the CLI boundary, Then it fails closed without output", () => {
    // Given: a policy document with an unrecognized field.
    const root = fixtureRoot();
    writeFileSync(join(root, "session.atf.json"), traceBytes("visible"));
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
    writeFileSync(join(root, "session.atf.json"), traceBytes("visible"));
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
    writeFileSync(join(root, "allowed.atf.json"), traceBytes("allowed"));
    writeFileSync(join(root, "denied.atf.json"), traceBytes("must-not-upload"));
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
