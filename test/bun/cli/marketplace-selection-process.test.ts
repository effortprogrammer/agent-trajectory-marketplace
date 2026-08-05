import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const decoder = new TextDecoder();

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
  events: [{ kind: "function_enter", name: "turn", payload: { role: "user", content: request } }],
}));

const selectorFor = (relativePath: string): string =>
  `s-${createHash("sha256").update(relativePath).digest("hex")}`;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const runCli = (argumentsList: readonly string[], environment?: Record<string, string | undefined>) => Bun.spawnSync(
  [process.execPath, "src/cli/index.ts", ...argumentsList],
  { cwd: process.cwd(), env: environment, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
);

const runCliAsync = async (argumentsList: readonly string[], environment?: Record<string, string | undefined>) => {
  const child = Bun.spawn([process.execPath, "src/cli/index.ts", ...argumentsList], {
    cwd: process.cwd(), env: environment, stderr: "pipe", stdin: "ignore", stdout: "pipe",
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
    expect(printed).toEqual({
      root: realpathSync(root),
      schemaVersion: 1,
      traces: expectedTraces,
    });
    expect(existsSync(join(root, "candidate.zip"))).toBe(false);
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
    await using server = Bun.serve({ fetch() {
      requests += 1;
      return Response.json({ protocolVersion: 1, submissionId: "sub_0123456789abcdefghjkmnpqrs", status: "accepted", statusUrl: "/v1/marketplace/seller/candidates/sub_0123456789abcdefghjkmnpqrs" }, { status: 202 });
    }, hostname: "127.0.0.1", port: 0 });
    const environment = { ...process.env, TRAJECTORY_REGISTRY_API_KEY: "env-sentinel" };

    // When: the bundle publishes with its selection.
    const result = await runCliAsync([
      "marketplace", "seller", "candidate", "publish",
      "--bundle", bundlePath, "--server", `http://127.0.0.1:${server.port}`,
      "--selection", selectionPath,
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
