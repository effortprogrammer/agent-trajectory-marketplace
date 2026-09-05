import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officialGatewayProcessArguments, officialGatewayProcessEnvironment } from "../fixtures/gateway-process";
import { uploadConsentPolicyJson } from "../../../src/marketplace/upload-consent";
const roots: string[] = [];
const decoder = new TextDecoder();
const residualSecret = `github_pat_${"a".repeat(82)}`;

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-selection-cli-"));
  roots.push(root);
  return root;
};

const traceBytes = (runtime: string, request: string): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime,
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "function_enter",
    name: "turn",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "usage-0",
    payload: {
      role: "user",
      content: request,
      usage: {
        inputTokens: 1,
        model: "claude-fable-5",
        outputTokens: 1,
      },
    },
  }],
}));

const residualSecretTraceBytes = (): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime: "senpi",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "function_enter",
    name: "turn",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "usage-0",
    payload: {
      content: residualSecret,
      role: "user",
      usage: {
        inputTokens: 1,
        model: "claude-fable-5",
        outputTokens: 1,
      },
    },
  }],
}));

const overEventCapTraceBytes = (): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 65_537,
  events: Array.from({ length: 65_537 }, () => ({ kind: "message", name: "assistant" })),
}));

const selectorFor = (relativePath: string): string =>
  `s-${createHash("sha256").update(relativePath).digest("hex")}`;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const approvalFor = (relativePath: string, bytes: Uint8Array): string =>
  `${selectorFor(relativePath)}@${sha256(bytes)}`;

const runCli = (argumentsList: readonly string[], environment?: Record<string, string | undefined>) => {
  const serverIndex = argumentsList.indexOf("--server");
  const target = serverIndex < 0 ? undefined : argumentsList[serverIndex + 1];
  const invocation = officialGatewayProcessArguments(
    [process.execPath, "src/cli/index.ts", ...(serverIndex < 0
      ? argumentsList
      : argumentsList.filter((_, index) => index !== serverIndex && index !== serverIndex + 1))],
    target,
  );
  return Bun.spawnSync(
    invocation.argumentsList,
    { cwd: process.cwd(), env: { ...process.env, ...environment, ...officialGatewayProcessEnvironment(invocation.target) }, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
  );
};

const runCliAsync = async (argumentsList: readonly string[], environment?: Record<string, string | undefined>) => {
  const serverIndex = argumentsList.indexOf("--server");
  const target = serverIndex < 0 ? undefined : argumentsList[serverIndex + 1];
  const invocation = officialGatewayProcessArguments(
    [process.execPath, "src/cli/index.ts", ...(serverIndex < 0
      ? argumentsList
      : argumentsList.filter((_, index) => index !== serverIndex && index !== serverIndex + 1))],
    target,
  );
  const child = Bun.spawn(invocation.argumentsList, {
    cwd: process.cwd(), env: { ...process.env, ...environment, ...officialGatewayProcessEnvironment(invocation.target) }, stderr: "pipe", stdin: "ignore", stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const writeSessions = (root: string): Readonly<{ first: Uint8Array; second: Uint8Array }> => {
  const first = traceBytes("codex", "first");
  const second = traceBytes("claude-code", "second");
  writeFileSync(join(root, "a.atf.json"), first);
  writeFileSync(join(root, "b.atf.json"), second);
  return { first, second };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("marketplace selection process boundary", () => {
  test("Given a session inventory, When print-selection runs, Then the exact upload set prints with zero writes", () => {
    // Given: two collected sessions.
    const root = fixtureRoot();
    const { first, second } = writeSessions(root);

    // When: the preview command runs without any output target.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection",
    ]);

    // Then: the canonical selection document names both traces and writes nothing.
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    const printed = JSON.parse(decoder.decode(result.stdout));
    const expectedTraces = [
      { byteCount: first.byteLength, selector: selectorFor("a.atf.json"), sha256: sha256(first) },
      { byteCount: second.byteLength, selector: selectorFor("b.atf.json"), sha256: sha256(second) },
    ].sort((left, right) => (left.selector < right.selector ? -1 : 1));
    expect(printed.root).toBe(realpathSync(root));
    expect(printed.schemaVersion).toBe(1);
    expect(printed.traces).toHaveLength(2);
    for (const expected of expectedTraces) {
      const actual = printed.traces.find((entry: { selector: string }) => entry.selector === expected.selector);
      if (actual === undefined) throw new Error(`missing selector ${expected.selector}`);
      expect(actual.byteCount).toBe(expected.byteCount);
      expect(actual.sha256).toBe(expected.sha256);
      expect(actual.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(actual.artifactByteCount).toBeGreaterThan(0);
      expect(actual.runtime).toBe(expected.selector === selectorFor("a.atf.json") ? "codex" : "claude-code");
      expect(actual.eventCount).toBe(1);
      expect(actual.earliestTimestamp).toBe("2026-09-01T00:00:00.000Z");
    }
    expect(existsSync(join(root, "candidate.zip"))).toBe(false);
  });

  test("Given collected sessions, When choose previews, Then topics and safe admission status are agent-readable", () => {
    const root = fixtureRoot();
    writeSessions(root);
    writeFileSync(join(root, "blocked.atf.json"), residualSecretTraceBytes());

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    const preview = JSON.parse(decoder.decode(result.stdout));
    expect(preview.root).toBe(realpathSync(root));
    expect(preview.schemaVersion).toBe(1);
    expect(preview.sessions).toHaveLength(3);
    expect(preview.sessions.find((item: { topic: string }) => item.topic === "first")?.admission).toEqual({
      status: "ready",
    });
    expect(preview.sessions.find((item: { topic: string }) => item.topic === "first")?.approval).toBe(
      approvalFor("a.atf.json", traceBytes("codex", "first")),
    );
    expect(preview.sessions.find((item: { topic: string }) => item.topic === "second")?.admission).toEqual({
      status: "ready",
    });
    const blocked = preview.sessions.find(
      (item: { admission: { status: string } }) => item.admission.status === "blocked",
    );
    expect(blocked?.topic).toBe("Content withheld: residual_secret");
    expect(blocked?.admission).toEqual({
      reason: "residual_secret",
      status: "blocked",
    });
    expect(blocked?.summary.requests).toEqual([]);
    expect(blocked?.summary.touched).toEqual([]);
    expect(blocked?.summary.errors).toEqual([]);
    expect(decoder.decode(result.stdout)).not.toContain(residualSecret);
  });

  test("Given a residual secret in metadata, When choose previews, Then all source text is withheld", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "blocked-runtime.atf.json"),
      traceBytes(residualSecret, "otherwise safe request"),
    );

    const json = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root, "--json",
    ]);
    const session = JSON.parse(decoder.decode(json.stdout)).sessions[0];
    expect(json.exitCode).toBe(0);
    expect(session.admission).toEqual({ reason: "residual_secret", status: "blocked" });
    expect(session.runtime).toBe("withheld");
    expect(session.earliestTimestamp).toBe("withheld");
    expect(decoder.decode(json.stdout)).not.toContain(residualSecret);

    const human = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root,
    ]);
    expect(human.exitCode).toBe(0);
    expect(decoder.decode(human.stdout)).not.toContain(residualSecret);
  });

  test("Given approved selectors, When choose writes, Then only those sessions enter the bound selection", () => {
    const root = fixtureRoot();
    writeSessions(root);
    const selectionPath = join(root, "selection.json");
    const bundlePath = join(root, "candidate.zip");
    const { second } = writeSessions(root);
    const selected = selectorFor("b.atf.json");

    const chosen = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("b.atf.json", second),
    ]);
    expect(chosen.exitCode).toBe(0);
    expect(decoder.decode(chosen.stderr)).toBe("");
    expect(JSON.parse(readFileSync(selectionPath, "utf8")).traces.map(
      (trace: { selector: string }) => trace.selector,
    )).toEqual([selected]);

    const bundled = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--selection", selectionPath, "--out", bundlePath,
    ]);
    expect(bundled.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(bundled.stdout))).toMatchObject({ traceCount: 1 });
    expect(existsSync(bundlePath)).toBe(true);
  });

  test("Given a blocked selector, When choose writes, Then no selection document is created", () => {
    const root = fixtureRoot();
    const blockedBytes = residualSecretTraceBytes();
    writeFileSync(join(root, "blocked.atf.json"), blockedBytes);
    const selectionPath = join(root, "selection.json");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("blocked.atf.json", blockedBytes),
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("denied_selection");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given ready and blocked sessions, When choose renders for a human, Then both states are visible", () => {
    const root = fixtureRoot();
    const { first } = writeSessions(root);
    writeFileSync(join(root, "blocked.atf.json"), residualSecretTraceBytes());

    const result = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root,
    ]);

    const output = decoder.decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    expect(output).toContain(`[ready] ${selectorFor("a.atf.json")}`);
    expect(output).toContain(`[blocked:residual_secret] ${selectorFor("blocked.atf.json")}`);
    expect(output).toContain("first");
    expect(output).not.toContain(residualSecret);
  });

  test("Given terminal control characters, When choose renders for a human, Then metadata is escaped", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "control.atf.json"), traceBytes("codex\u001b[31m", "safe request"));

    const result = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root,
    ]);

    const output = decoder.decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(output).not.toContain("\u001b");
    expect(output).toContain("[control:U+001B]");
  });

  test("Given duplicate selectors, When choose writes, Then it fails before creating output", () => {
    const root = fixtureRoot();
    const { first } = writeSessions(root);
    const selectionPath = join(root, "selection.json");
    const selected = selectorFor("a.atf.json");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("a.atf.json", first),
      "--approve", approvalFor("a.atf.json", first),
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("duplicate_trace");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given duplicate source content, When choose writes, Then it fails before downstream bundle admission", () => {
    const root = fixtureRoot();
    const bytes = traceBytes("codex", "same content");
    writeFileSync(join(root, "a.atf.json"), bytes);
    writeFileSync(join(root, "b.atf.json"), bytes);
    const selectionPath = join(root, "selection.json");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("a.atf.json", bytes),
      "--approve", approvalFor("b.atf.json", bytes),
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("duplicate_trace");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given distinct sources with duplicate sanitized artifacts, When choose writes, Then it fails locally", () => {
    const root = fixtureRoot();
    const compact = traceBytes("codex", "same semantic content");
    const formatted = new TextEncoder().encode(
      JSON.stringify(JSON.parse(decoder.decode(compact)), null, 2),
    );
    expect(sha256(compact)).not.toBe(sha256(formatted));
    writeFileSync(join(root, "compact.atf.json"), compact);
    writeFileSync(join(root, "formatted.atf.json"), formatted);
    const selectionPath = join(root, "selection.json");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("compact.atf.json", compact),
      "--approve", approvalFor("formatted.atf.json", formatted),
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("duplicate_trace");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given content changed after preview, When choose writes, Then the stale approval fails", () => {
    const root = fixtureRoot();
    const original = traceBytes("codex", "original");
    const changed = traceBytes("codex", "changed");
    writeFileSync(join(root, "session.atf.json"), original);
    const approval = approvalFor("session.atf.json", original);
    writeFileSync(join(root, "session.atf.json"), changed);
    const selectionPath = join(root, "selection.json");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath, "--approve", approval,
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("trace_drift");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given a trace above publish event limits, When choose previews and writes, Then it is blocked locally", () => {
    const root = fixtureRoot();
    const bytes = overEventCapTraceBytes();
    writeFileSync(join(root, "too-many-events.atf.json"), bytes);
    const preview = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root, "--json",
    ]);

    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(preview.stdout)).sessions[0].admission).toEqual({
      reason: "archive_policy",
      status: "blocked",
    });
    const selectionPath = join(root, "selection.json");
    const write = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("too-many-events.atf.json", bytes),
    ]);
    expect(write.exitCode).toBe(1);
    expect(decoder.decode(write.stderr)).toContain("denied_selection");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given a missing selector, When choose writes, Then it fails before creating output", () => {
    const root = fixtureRoot();
    writeSessions(root);
    const selectionPath = join(root, "selection.json");
    const missingBytes = traceBytes("codex", "missing");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("missing.atf.json", missingBytes),
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("missing_selector");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given an existing output, When choose writes, Then it preserves the file without temp residue", () => {
    const root = fixtureRoot();
    const { first } = writeSessions(root);
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, "original");

    const result = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      "--approve", approvalFor("a.atf.json", first),
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("output_exists");
    expect(readFileSync(selectionPath, "utf8")).toBe("original");
    expect(readdirSync(root).filter((name) => name.includes(".trajectory-tmp-"))).toEqual([]);
  });

  test("Given too many approved selectors, When choose writes, Then it fails with a stable local error", () => {
    const root = fixtureRoot();
    const approvals: string[] = [];
    for (let index = 0; index < 101; index += 1) {
      const relativePath = `session-${index}.atf.json`;
      const bytes = traceBytes("codex", `request-${index}`);
      writeFileSync(join(root, relativePath), bytes);
      approvals.push(approvalFor(relativePath, bytes));
    }
    const selectionPath = join(root, "selection.json");
    const argumentsList = [
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      ...approvals.flatMap((approval) => ["--approve", approval]),
    ];

    const result = runCli(argumentsList);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("invalid_bundle_request");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given more sessions than one selection allows, When choose previews, Then it fails locally", () => {
    const root = fixtureRoot();
    for (let index = 0; index < 101; index += 1) {
      writeFileSync(
        join(root, `session-${index}.atf.json`),
        traceBytes("codex", `request-${index}`),
      );
    }

    const result = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root, "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("invalid_bundle_request");
  });

  test("Given a preview above the document byte cap, When choose previews, Then it fails locally", () => {
    const root = fixtureRoot();
    const longRuntime = "runtime-".repeat(2_048);
    for (let index = 0; index < 100; index += 1) {
      writeFileSync(
        join(root, `session-${index}.atf.json`),
        traceBytes(longRuntime, `request-${index}`),
      );
    }

    const result = runCli([
      "marketplace", "seller", "sessions", "choose", "--root", root, "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("invalid_bundle_request");
    const selectionPath = join(root, "selection.json");
    const approvals = Array.from({ length: 100 }, (_, index) => {
      const relativePath = `session-${index}.atf.json`;
      return approvalFor(relativePath, traceBytes(longRuntime, `request-${index}`));
    });
    const write = runCli([
      "marketplace", "seller", "sessions", "choose",
      "--root", root, "--out", selectionPath,
      ...approvals.flatMap((approval) => ["--approve", approval]),
    ]);
    expect(write.exitCode).toBe(1);
    expect(decoder.decode(write.stderr)).toContain("invalid_bundle_request");
    expect(existsSync(selectionPath)).toBe(false);
  });

  test("Given a seller asks for choose help, Then the local approval workflow is discoverable", () => {
    const result = runCli([
      "marketplace", "seller", "sessions", "choose", "--help",
    ]);

    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stderr)).toBe("");
    expect(decoder.decode(result.stdout)).toContain("sessions choose");
    expect(decoder.decode(result.stdout)).toStartWith(
      "Usage: trajectory marketplace seller sessions choose",
    );
    expect(decoder.decode(result.stdout)).toContain("--approve");
    for (const action of ["list", "inspect"]) {
      const related = runCli([
        "marketplace", "seller", "sessions", action, "--help",
      ]);
      expect(related.exitCode).toBe(0);
      expect(decoder.decode(related.stderr)).toBe("");
      expect(decoder.decode(related.stdout)).toContain(`sessions ${action}`);
    }
  });

  test("Given an inventory above the archive trace cap, When print-selection runs, Then it fails explicitly", () => {
    // Given: more valid sessions than a dataset archive can contain.
    const root = fixtureRoot();
    for (let index = 0; index < 101; index += 1) {
      writeFileSync(join(root, `session-${index}.atf.json`), traceBytes("codex", `request-${index}`));
    }

    // When: the preview command runs.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection",
    ]);

    // Then: the unbuildable membership is rejected at preview time.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_selection\"}\n");
  });

  test("Given previews exceeding the document cap, When print-selection runs, Then it fails explicitly", () => {
    // Given: a valid inventory whose serialized selection exceeds the document read cap.
    const root = fixtureRoot();
    for (let index = 0; index < 100; index += 1) {
      const document = JSON.parse(decoder.decode(traceBytes("codex", `request-${index}`)));
      document.runtime = "x".repeat(16_384);
      writeFileSync(join(root, `session-${index}.atf.json`), JSON.stringify(document));
    }

    // When: the preview command runs.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection",
    ]);

    // Then: the oversized document is rejected instead of emitting an unreadable preview.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_selection\"}\n");
  });

  test("Given a trace whose artifact exceeds archive policy, When print-selection runs, Then it fails explicitly", () => {
    // Given: a valid trace whose sanitized artifact crosses the per-trace archive cap.
    const root = fixtureRoot();
    const oversized = {
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 4_400,
      events: Array.from({ length: 4_400 }, () => ({
        kind: "function_enter",
        name: "turn",
        payload: { role: "user", content: "x".repeat(16_000) },
      })),
    };
    writeFileSync(join(root, "huge.atf.json"), JSON.stringify(oversized));

    // When: the preview command runs.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection",
    ]);

    // Then: the unbuildable artifact is rejected at preview time.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_selection\"}\n");
  });

  test("Given a deeply nested selection file, When bundle runs, Then a stable error rejects it", () => {
    // Given: a selection file nested far beyond the parser stack.
    const root = fixtureRoot();
    writeSessions(root);
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, "[".repeat(100_000) + "]".repeat(100_000));
    const output = join(root, "candidate.zip");

    // When: the bundle builds from it.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--out", output, "--selection", selectionPath,
    ]);

    // Then: the stable marketplace error replaces any parser overflow.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
    expect(existsSync(output)).toBe(false);
  });

  test("Given a tampered artifact hash, When bundle runs, Then it fails closed", () => {
    // Given: a previewed selection whose artifact binding was altered.
    const root = fixtureRoot();
    writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const document = JSON.parse(decoder.decode(preview.stdout));
    const firstEntry = document.traces[0];
    if (firstEntry === undefined) throw new Error("preview returned no traces");
    firstEntry.artifactSha256 = "0".repeat(64);
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, JSON.stringify(document));
    const output = join(root, "candidate.zip");

    // When: the bundle builds from the tampered document.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--out", output, "--selection", selectionPath,
    ]);

    // Then: the artifact binding mismatch is rejected before writing.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
    expect(existsSync(output)).toBe(false);
  });

  test("Given print-selection with an output flag, When parsed, Then the combination is rejected", () => {
    // Given: a preview invocation carrying a bundle output flag.
    const root = fixtureRoot();

    // When: the command runs.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--print-selection", "--out", join(root, "candidate.zip"),
    ]);

    // Then: the ambiguous combination fails closed.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
  });

  test("Given an edited selection, When bundle runs, Then only the selected trace enters the ZIP", () => {
    // Given: a previewed inventory with one trace removed from the document.
    const root = fixtureRoot();
    const { first } = writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const document = JSON.parse(decoder.decode(preview.stdout));
    document.traces = document.traces.filter((trace: { selector: string }) => trace.selector === selectorFor("a.atf.json"));
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, JSON.stringify(document));
    const output = join(root, "candidate.zip");

    // When: the bundle builds from the edited selection.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--out", output, "--selection", selectionPath,
    ]);

    // Then: exactly the approved membership enters the archive.
    expect(result.exitCode).toBe(0);
    const zipList = Bun.spawnSync(["unzip", "-l", output], { stdout: "pipe" });
    const listing = decoder.decode(zipList.stdout);
    expect(listing).toContain(`traces/${selectorFor("a.atf.json")}.atf.json`);
    expect(listing).not.toContain(`traces/${selectorFor("b.atf.json")}.atf.json`);
    expect(listing).toContain("dataset-manifest.json");
    expect(first.byteLength).toBeGreaterThan(0);
  });

  test("Given a selected trace modified after preview, When bundle runs, Then it fails closed without writing", () => {
    // Given: a selection whose trace changed on disk after the preview.
    const root = fixtureRoot();
    writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, preview.stdout);
    writeFileSync(join(root, "a.atf.json"), traceBytes("codex", "mutated"));
    const output = join(root, "candidate.zip");

    // When: the bundle builds from the now-stale selection.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--out", output, "--selection", selectionPath,
    ]);

    // Then: drift is rejected and no archive is written.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
    expect(existsSync(output)).toBe(false);
  });

  test("Given a selection naming an absent trace, When bundle runs, Then it fails closed", () => {
    // Given: a selection whose selector is not in the inventory.
    const root = fixtureRoot();
    writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const document = JSON.parse(decoder.decode(preview.stdout));
    const firstEntry = document.traces[0];
    if (firstEntry === undefined) throw new Error("preview returned no traces");
    firstEntry.selector = `s-${"f".repeat(64)}`;
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, JSON.stringify(document));
    const output = join(root, "candidate.zip");

    // When: the bundle builds from it.
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--out", output, "--selection", selectionPath,
    ]);

    // Then: the unknown membership is rejected before writing.
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
    expect(existsSync(output)).toBe(false);
  });

  test("Given an empty or malformed selection, When bundle runs, Then it fails closed", () => {
    // Given: one selection with zero traces and one that is not JSON.
    const root = fixtureRoot();
    writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const document = JSON.parse(decoder.decode(preview.stdout));
    document.traces = [];
    const emptyPath = join(root, "empty.json");
    const malformedPath = join(root, "malformed.json");
    writeFileSync(emptyPath, JSON.stringify(document));
    writeFileSync(malformedPath, "{");
    const output = join(root, "candidate.zip");

    // When: each crosses the bundle boundary.
    const empty = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output, "--selection", emptyPath]);
    const malformed = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output, "--selection", malformedPath]);

    // Then: both fail closed without writing.
    expect(empty.exitCode).toBe(1);
    expect(malformed.exitCode).toBe(1);
    expect(decoder.decode(empty.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
    expect(decoder.decode(malformed.stderr)).toBe("{\"error\":\"invalid_bundle_request\"}\n");
    expect(existsSync(output)).toBe(false);
  });

  test("Given a matching selection, When publish runs, Then the receipt records the approved membership", async () => {
    // Given: a bundle built from a one-trace selection and a loopback registry.
    const root = fixtureRoot();
    writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const document = JSON.parse(decoder.decode(preview.stdout));
    document.traces = document.traces.filter((trace: { selector: string }) => trace.selector === selectorFor("a.atf.json"));
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, JSON.stringify(document));
    const bundlePath = join(root, "candidate.zip");
    runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", bundlePath, "--selection", selectionPath]);
    let requests = 0;
    await using server = Bun.serve({ fetch(request) {
      if (request.method === "GET") return new Response(uploadConsentPolicyJson, { status: 200 });
      requests += 1;
      return Response.json({ protocolVersion: 1, submissionId: "sub_0123456789abcdefghjkmnpqrs", status: "accepted", statusUrl: "/v1/marketplace/seller/candidates/sub_0123456789abcdefghjkmnpqrs" }, {
        headers: { "x-atm-upload-consent-sha256": createHash("sha256").update(Buffer.from(request.headers.get("x-atm-upload-consent") ?? "", "base64url")).digest("hex") },
        status: 202,
      });
    }, hostname: "127.0.0.1", port: 0 });
    const environment = { ...process.env, TRAJECTORY_REGISTRY_API_KEY: "env-sentinel" };

    // When: the bundle publishes with its selection.
    const result = await runCliAsync([
      "marketplace", "seller", "candidate", "publish",
      "--bundle", bundlePath, "--server", `http://127.0.0.1:${server.port}`,
      "--selection", selectionPath,
      "--commercial-use", "yes", "--consent-policy", "session-commercial-use-v1",
    ], environment);

    // Then: one request ships and stdout records the approved membership.
    expect(result.exitCode).toBe(0);
    expect(requests).toBe(1);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.membership).toEqual([selectorFor("a.atf.json")]);
    expect(receipt.status).toBe("accepted");
  });

  test("Given a bundle whose membership differs from the selection, When publish runs, Then zero requests ship", async () => {
    // Given: a full-inventory bundle but a selection approving only one trace.
    const root = fixtureRoot();
    writeSessions(root);
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--print-selection"]);
    const document = JSON.parse(decoder.decode(preview.stdout));
    document.traces = document.traces.filter((trace: { selector: string }) => trace.selector === selectorFor("a.atf.json"));
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, JSON.stringify(document));
    const bundlePath = join(root, "candidate.zip");
    runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", bundlePath, "--trace", "a.atf.json", "--trace", "b.atf.json"]);
    let requests = 0;
    await using server = Bun.serve({ fetch() {
      requests += 1;
      return Response.json({ protocolVersion: 1, submissionId: "sub_0123456789abcdefghjkmnpqrs", status: "accepted", statusUrl: "/v1/marketplace/seller/candidates/sub_0123456789abcdefghjkmnpqrs" }, { status: 202 });
    }, hostname: "127.0.0.1", port: 0 });
    const environment = { ...process.env, TRAJECTORY_REGISTRY_API_KEY: "env-sentinel" };

    // When: publish is attempted with the narrower selection.
    const result = await runCliAsync([
      "marketplace", "seller", "candidate", "publish",
      "--bundle", bundlePath, "--server", `http://127.0.0.1:${server.port}`,
      "--selection", selectionPath,
    ], environment);

    // Then: the membership mismatch is rejected locally before transport.
    expect(result.exitCode).toBe(1);
    expect(requests).toBe(0);
    expect(result.stderr).toBe("{\"error\":\"invalid_bundle_request\"}\n");
  });

  test("Given a substituted bundle sharing the selector, When publish runs, Then byte binding rejects it", async () => {
    // Given: a reviewed selection from one root and a same-path bundle built from different bytes.
    const reviewed = fixtureRoot();
    const substituted = fixtureRoot();
    writeFileSync(join(reviewed, "session.atf.json"), traceBytes("codex", "reviewed content"));
    writeFileSync(join(substituted, "session.atf.json"), traceBytes("codex", "substituted credential-shaped content"));
    const preview = runCli(["marketplace", "seller", "candidate", "bundle", "--root", reviewed, "--print-selection"]);
    const selectionPath = join(reviewed, "selection.json");
    writeFileSync(selectionPath, preview.stdout);
    const bundlePath = join(substituted, "candidate.zip");
    runCli(["marketplace", "seller", "candidate", "bundle", "--root", substituted, "--out", bundlePath, "--trace", "session.atf.json"]);
    let requests = 0;
    await using server = Bun.serve({ fetch() {
      requests += 1;
      return Response.json({ protocolVersion: 1, submissionId: "sub_0123456789abcdefghjkmnpqrs", status: "accepted", statusUrl: "/v1/marketplace/seller/candidates/sub_0123456789abcdefghjkmnpqrs" }, { status: 202 });
    }, hostname: "127.0.0.1", port: 0 });
    const environment = { ...process.env, TRAJECTORY_REGISTRY_API_KEY: "env-sentinel" };

    // When: the substituted bundle publishes with the reviewed selection.
    const result = await runCliAsync([
      "marketplace", "seller", "candidate", "publish",
      "--bundle", bundlePath, "--server", `http://127.0.0.1:${server.port}`,
      "--selection", selectionPath,
    ], environment);

    // Then: identical selectors cannot smuggle substituted bytes.
    expect(result.exitCode).toBe(1);
    expect(requests).toBe(0);
    expect(result.stderr).toBe("{\"error\":\"invalid_bundle_request\"}\n");
  });

  test("Given a malformed selection at publish, When publish runs, Then zero requests ship", async () => {
    // Given: a valid bundle and a selection file that is not a selection document.
    const root = fixtureRoot();
    writeSessions(root);
    const bundlePath = join(root, "candidate.zip");
    runCli(["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", bundlePath, "--trace", "a.atf.json"]);
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, "not a selection");
    let requests = 0;
    await using server = Bun.serve({ fetch() {
      requests += 1;
      return Response.json({ protocolVersion: 1, submissionId: "sub_0123456789abcdefghjkmnpqrs", status: "accepted", statusUrl: "/v1/marketplace/seller/candidates/sub_0123456789abcdefghjkmnpqrs" }, { status: 202 });
    }, hostname: "127.0.0.1", port: 0 });
    const environment = { ...process.env, TRAJECTORY_REGISTRY_API_KEY: "env-sentinel" };

    // When: publish is attempted.
    const result = await runCliAsync([
      "marketplace", "seller", "candidate", "publish",
      "--bundle", bundlePath, "--server", `http://127.0.0.1:${server.port}`,
      "--selection", selectionPath,
    ], environment);

    // Then: rejection happens before credentials and transport.
    expect(result.exitCode).toBe(1);
    expect(requests).toBe(0);
    expect(result.stderr).toBe("{\"error\":\"invalid_bundle_request\"}\n");
  });
});
