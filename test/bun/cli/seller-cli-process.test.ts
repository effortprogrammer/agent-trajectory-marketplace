import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { officialRegistryOrigin } from "../../../src/auth/official-origin";
import { writeStoredAuthSession } from "../../../src/auth/store";

const roots: string[] = [];
const fixtureRoot = join(import.meta.dir, "../../../contract");
const tokenCanary = "stored-session-token-canary";
const otpCanary = "otp-canary";
const operationRequest = "00000000-0000-4000-8000-000000000301";
const operationWithdraw = "00000000-0000-4000-8000-000000000302";
type CliResult = Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>;
type RequestRecord = Readonly<{ readonly authorization: string | null; readonly body: string; readonly contentType: string | null; readonly idempotencyKey: string | null; readonly method: string; readonly path: string; readonly query: string }>;

const root = (): string => {
  const value = mkdtempSync(join(tmpdir(), "seller-cli-process-"));
  roots.push(value);
  return value;
};
const fixture = (path: string): string => readFileSync(join(fixtureRoot, path), "utf8");
const environment = (configRoot: string, target: string): Record<string, string> => {
  const value: Record<string, string> = { ...process.env, TRAJECTORY_MARKETPLACE_CONFIG_HOME: configRoot, TRAJECTORY_TEST_GATEWAY_TARGET: target };
  delete value.TRAJECTORY_REGISTRY_API_KEY;
  return value;
};
const store = (configRoot: string, expiresAt = "2099-01-01T00:00:00.000Z"): void => {
  writeStoredAuthSession({ accessToken: tokenCanary, accountId: "acct-0123456789abcdef", expiresAt, server: officialRegistryOrigin, tokenType: "Bearer" }, { storePath: join(configRoot, "agent-trajectory-marketplace", "auth.json") });
};
const runBuilt = async (argumentsList: readonly string[], env: Readonly<Record<string, string>>, terminal = false): Promise<CliResult> => {
  const invocation = terminal
    ? ["script", "-q", "/dev/null", process.execPath, "--preload", "./test/bun/fixtures/gateway-fetch-preload.ts", "dist/collector.js", ...argumentsList]
    : [process.execPath, "--preload", "./test/bun/fixtures/gateway-fetch-preload.ts", "dist/collector.js", ...argumentsList];
  const child = Bun.spawn(invocation, { cwd: process.cwd(), env, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
  return { exitCode, stderr, stdout };
};

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], { cwd: process.cwd(), stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(new TextDecoder().decode(build.stderr));
});
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true }); });

describe("seller CLI built process boundary", () => {
  test("Given an active stored session, When every seller command runs, Then it uses exact bounded gateway requests and prints strict receipts", async () => {
    // Given
    const requests: RequestRecord[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url);
      requests.push({ authorization: request.headers.get("authorization"), body: await request.text(), contentType: request.headers.get("content-type"), idempotencyKey: request.headers.get("idempotency-key"), method: request.method, path: url.pathname, query: url.search });
      const body = (() => {
        if (url.pathname === "/v1/marketplace/seller/candidates" && url.search === "?limit=2") return fixture("upload-list/v1/candidates-page-1-200.json");
        if (url.pathname === "/v1/marketplace/seller/candidates" && url.search === "?cursor=cursor-two&limit=2") return fixture("upload-list/v1/candidates-page-2-200.json");
        if (url.pathname === "/v1/marketplace/seller/sales/sessions") return fixture("seller-sales/v1/sessions-200.json");
        if (url.pathname === "/v1/marketplace/seller/sales/earnings") return fixture("seller-sales/v1/earnings-200.json");
        if (url.pathname === "/v1/marketplace/seller/sales/ledger") return fixture("seller-sales/v1/ledger-200.json");
        if (url.pathname === "/v1/marketplace/seller/payout-request" && request.method === "GET") return fixture("payout-request/v1/get-empty-200.json");
        if (url.pathname === "/v1/marketplace/seller/payout-request" && request.method === "POST") return fixture("payout-request/v1/requested-201.json");
        if (url.pathname === "/v1/marketplace/seller/payout-request/withdraw") return fixture("payout-request/v1/withdrawn-200.json");
        throw new Error(`unexpected request ${request.method} ${url.pathname}${url.search}`);
      })();
      return new Response(body, { headers: { "content-type": "application/json" }, status: request.method === "POST" && url.pathname.endsWith("payout-request") ? 201 : 200 });
    } });
    const configRoot = root(); store(configRoot); const env = environment(configRoot, `http://127.0.0.1:${server.port}`);
    // When
    const results = [
      await runBuilt(["marketplace", "seller", "candidate", "list", "--limit", "2"], env),
      await runBuilt(["marketplace", "seller", "sales", "sessions", "--from", "2026-08-01", "--to", "2026-08-30", "--limit", "2"], env),
      await runBuilt(["marketplace", "seller", "sales", "earnings", "--from", "2026-08-01", "--to", "2026-08-30", "--interval", "day"], env),
      await runBuilt(["marketplace", "seller", "sales", "ledger", "--cursor", "ledger-one", "--limit", "2"], env),
      await runBuilt(["marketplace", "seller", "payout", "status"], env),
      await runBuilt(["marketplace", "seller", "payout", "request", "--operation-id", operationRequest], env),
      await runBuilt(["marketplace", "seller", "payout", "withdraw", "--operation-id", operationWithdraw], env),
    ]; server.stop(true);
    // Then
    expect(results.map((result) => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(results.map((result) => result.stderr)).toEqual(["", "", "", "", "", "", ""]);
    expect(results.map((result) => JSON.parse(result.stdout))).toEqual([
      JSON.parse(fixture("upload-list/v1/candidates-merged-200.json")), JSON.parse(fixture("seller-sales/v1/sessions-200.json")), JSON.parse(fixture("seller-sales/v1/earnings-200.json")), JSON.parse(fixture("seller-sales/v1/ledger-200.json")), JSON.parse(fixture("payout-request/v1/get-empty-200.json")), JSON.parse(fixture("payout-request/v1/requested-201.json")), JSON.parse(fixture("payout-request/v1/withdrawn-200.json")),
    ]);
    expect(requests).toEqual([
      { authorization: `Bearer ${tokenCanary}`, body: "", contentType: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/candidates", query: "?limit=2" },
      { authorization: `Bearer ${tokenCanary}`, body: "", contentType: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/candidates", query: "?cursor=cursor-two&limit=2" },
      { authorization: `Bearer ${tokenCanary}`, body: "", contentType: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/sales/sessions", query: "?from=2026-08-01&to=2026-08-30&limit=2" },
      { authorization: `Bearer ${tokenCanary}`, body: "", contentType: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/sales/earnings", query: "?from=2026-08-01&to=2026-08-30&interval=day" },
      { authorization: `Bearer ${tokenCanary}`, body: "", contentType: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/sales/ledger", query: "?cursor=ledger-one&limit=2" },
      { authorization: `Bearer ${tokenCanary}`, body: "", contentType: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/payout-request", query: "" },
      { authorization: `Bearer ${tokenCanary}`, body: "{}", contentType: "application/json", idempotencyKey: operationRequest, method: "POST", path: "/v1/marketplace/seller/payout-request", query: "" },
      { authorization: `Bearer ${tokenCanary}`, body: "{}", contentType: "application/json", idempotencyKey: operationWithdraw, method: "POST", path: "/v1/marketplace/seller/payout-request/withdraw", query: "" },
    ]);
  });

  test("Given invalid commands or sessions, When the built CLI runs, Then no request or auth canary reaches its output", async () => {
    // Given
    let requests = 0; const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { requests += 1; return Response.json({ ok: true }); } });
    const configRoot = root(); const env = environment(configRoot, `http://127.0.0.1:${server.port}`);
    const invalid = [["marketplace", "seller", "candidate", "list", "--cursor", "bad cursor"], ["marketplace", "seller", "candidate", "list", "--limit", "0"], ["marketplace", "seller", "candidate", "list", "--cursor", "one", "--cursor", "two"], ["marketplace", "seller", "sales", "sessions", "--limit", "2", "--limit", "3"], ["marketplace", "seller", "payout", "request", "--operation-id", "00000000-0000-1000-8000-000000000301"], ["marketplace", "seller", "payout", "withdraw", "--operation-id", operationWithdraw, "--operation-id", operationWithdraw]] as const;
    // When
    const missing = await runBuilt(["marketplace", "seller", "payout", "status"], env); store(configRoot, "2020-01-01T00:00:00.000Z");
    const expired = await runBuilt(["marketplace", "seller", "candidate", "list"], env); const invalidResults = await Promise.all(invalid.map((command) => runBuilt(command, env))); server.stop(true);
    // Then
    expect(requests).toBe(0);
    for (const result of [missing, expired, ...invalidResults]) { expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(`${result.stdout}${result.stderr}`).not.toContain(tokenCanary); expect(`${result.stdout}${result.stderr}`).not.toContain(otpCanary); }
  });

  test("Given the built CLI under a real PTY, When every named success command runs, Then each exits zero with its observable output", async () => {
    // Given
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const body = path.endsWith("candidates") ? fixture("upload-list/v1/candidates-200.json") : path.endsWith("sales/sessions") ? fixture("seller-sales/v1/sessions-200.json") : path.endsWith("sales/earnings") ? fixture("seller-sales/v1/earnings-200.json") : path.endsWith("sales/ledger") ? fixture("seller-sales/v1/ledger-200.json") : path.endsWith("withdraw") ? fixture("payout-request/v1/withdrawn-200.json") : request.method === "POST" ? fixture("payout-request/v1/requested-201.json") : fixture("payout-request/v1/get-empty-200.json");
      return new Response(body, { headers: { "content-type": "application/json" }, status: request.method === "POST" && !path.endsWith("withdraw") ? 201 : 200 });
    } });
    const configRoot = root(); store(configRoot); const env = environment(configRoot, `http://127.0.0.1:${server.port}`);
    const commands = [["auth", "--help"], ["marketplace", "seller", "candidate", "list"], ["marketplace", "seller", "sales", "sessions"], ["marketplace", "seller", "sales", "earnings"], ["marketplace", "seller", "sales", "ledger"], ["marketplace", "seller", "payout", "status"], ["marketplace", "seller", "payout", "request", "--operation-id", operationRequest], ["marketplace", "seller", "payout", "withdraw", "--operation-id", operationWithdraw]] as const;
    // When
    const results = await Promise.all(commands.map((command) => runBuilt(command, env, true))); server.stop(true);
    // Then
    expect(results.map((result) => result.exitCode)).toEqual(new Array(commands.length).fill(0)); expect(results.map((result) => result.stderr)).toEqual(new Array(commands.length).fill("")); expect(results[0]?.stdout).toContain("Usage: trajectory auth"); for (const result of results.slice(1)) expect(result.stdout).toContain('"ok":true');
  });
});
