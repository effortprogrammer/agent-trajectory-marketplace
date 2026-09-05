import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeDatasetManifest } from "../../src/marketplace/archive-contract";
import { sanitizedArtifactDigest, sanitizedTraceBytes } from "../../src/marketplace/dataset-archive";
import { encodeSelectionDocument } from "../../src/marketplace/selection-contract";
import { writeDatasetZip } from "../../src/marketplace/stored-zip";
import { uploadConsentPolicy } from "../../src/marketplace/upload-consent";

const target = new URL(process.env.ATM_CONSENT_QA_TARGET ?? "");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.protocol, "http:");
assert.equal(target.pathname, "/");
const key = process.env.ATM_CONSENT_QA_KEY;
assert.ok(key);

const root = mkdtempSync(join(tmpdir(), "atm-consent-http-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const source = Buffer.from(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "message",
    name: "assistant",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "consent-qa-usage",
    payload: { usage: { inputTokens: 1, model: "claude-fable-5", outputTokens: 1 } },
  }],
}));
const artifact = sanitizedArtifactDigest(source);
const label = `s-${"0".repeat(64)}`;
const tracePath = `traces/${label}.atf.json`;
const bundlePath = join(root, "candidate.zip");
const selectionPath = join(root, "selection.json");
const manifest = encodeDatasetManifest({
  artifacts: [{ ...artifact, label, path: tracePath }],
  formatVersion: 1,
});
writeFileSync(bundlePath, writeDatasetZip([
  { name: "dataset-manifest.json", data: manifest },
  { name: tracePath, data: sanitizedTraceBytes(source) },
]));
writeFileSync(selectionPath, encodeSelectionDocument({
  root,
  schemaVersion: 1,
  traces: [{
    artifactByteCount: artifact.byteCount,
    artifactSha256: artifact.sha256,
    byteCount: source.byteLength,
    earliestTimestamp: "2026-09-01T00:00:00.000Z",
    eventCount: 1,
    runtime: "codex",
    selector: label,
    sha256: createHash("sha256").update(source).digest("hex"),
    summary: {
      counts: { actions: 0, errors: 0, redacted: 0, requests: 0, results: 0, truncated: 0 },
      errors: [],
      requests: [],
      touched: [],
    },
  }],
}));

const requests: { method: string; status: number }[] = [];
let captured: { headers: Headers; bytes: Uint8Array<ArrayBuffer> } | undefined;
let policyMode: "normal" | "missing" | "mismatch" = "normal";
const proxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, target);
    if (request.method === "GET" && policyMode !== "normal") {
      const response = policyMode === "missing"
        ? new Response(null, { status: 404 })
        : Response.json({ ...uploadConsentPolicy, policySha256: "0".repeat(64) });
      requests.push({ method: "GET", status: response.status });
      return response;
    }
    const bytes = request.method === "POST"
      ? new Uint8Array(await request.arrayBuffer())
      : undefined;
    if (bytes !== undefined) captured = { headers: new Headers(request.headers), bytes };
    const response = await fetch(upstream, {
      method: request.method,
      headers: request.headers,
      body: bytes,
      redirect: "error",
    });
    requests.push({ method: request.method, status: response.status });
    return response;
  },
});

const run = async (options: readonly string[]) => {
  const child = Bun.spawn([
    process.execPath,
    "--preload", "./test/bun/fixtures/gateway-fetch-preload.ts",
    "./dist/collector.js",
    "marketplace", "seller", "candidate", "publish",
    "--bundle", bundlePath, "--selection", selectionPath,
    ...options,
  ], {
    cwd: import.meta.dir + "/../..",
    env: {
      PATH: process.env.PATH,
      HOME: root,
      XDG_STATE_HOME: join(root, "state"),
      TRAJECTORY_REGISTRY_API_KEY: key,
      TRAJECTORY_TEST_GATEWAY_TARGET: proxy.url.toString(),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

try {
  for (const options of [
    [],
    ["--commercial-use", "no"],
    ["--commercial-use", "yes", "--consent-policy", "not-current"],
  ]) {
    const result = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.equal(requests.length, 0);
  }
  const affirmative = ["--commercial-use", "yes", "--consent-policy", uploadConsentPolicy.policyVersion];
  const first = await run(affirmative);
  assert.equal(first.exitCode, 0, first.stderr);
  const replay = await run(affirmative);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(replay.stdout, first.stdout);
  assert.deepEqual(requests.map(({ method, status }) => [method, status]), [
    ["GET", 200], ["POST", 202], ["GET", 200], ["POST", 202],
  ]);
  assert.ok(captured);
  const consentHeader = captured.headers.get("x-atm-upload-consent");
  assert.ok(consentHeader);
  const consent = JSON.parse(Buffer.from(consentHeader, "base64url").toString("utf8")) as Record<string, unknown>;
  assert.equal(consent.publicExamples, false);
  for (const mutation of ["missing", "public-examples", "archive-mismatch"]) {
    const headers: Headers = new Headers(captured.headers);
    if (mutation === "missing") {
      headers.delete("x-atm-upload-consent");
    } else {
      const altered = mutation === "public-examples"
        ? { ...consent, publicExamples: true }
        : { ...consent, archiveSha256: "0".repeat(64) };
      headers.set("x-atm-upload-consent", Buffer.from(JSON.stringify(altered)).toString("base64url"));
    }
    const response: Response = await fetch(new URL("/v1/marketplace/seller/candidates", target), {
      method: "POST", headers, body: captured.bytes,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { protocolVersion: 1, code: "invalid_candidate" });
  }
  for (const mode of ["missing", "mismatch"] as const) {
    policyMode = mode;
    const previousPosts = requests.filter(({ method }) => method === "POST").length;
    const result = await run(affirmative);
    assert.notEqual(result.exitCode, 0);
    assert.equal(requests.filter(({ method }) => method === "POST").length, previousPosts);
  }
  console.log(JSON.stringify({
    status: "PASS",
    localRefusals: 3,
    acceptedPosts: 2,
    exactRetry: true,
    invalidServerConsentsRejected: 3,
    incompatiblePoliciesBlockedBeforePost: 2,
    publicExamples: false,
    policySha256: consent.policySha256,
  }));
} finally {
  proxy.stop(true);
  rmSync(root, { recursive: true, force: true });
}
