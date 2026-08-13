import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  officialGatewayProcessArguments,
  officialGatewayProcessEnvironment,
} from "../fixtures/gateway-process";

const decoder = new TextDecoder();
const servers: Bun.Server<undefined>[] = [];
const contractRoot = join(import.meta.dir, "../../../contract/world/v1");
const contractId = "00000000-0000-4000-8000-000000000002";
const entitlementId = "00000000-0000-4000-8000-000000000001";
const instanceId = "instance-7f1a9c2e";
const packDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const worldId = "world/refund-unit";

const fixture = (name: string): string => readFileSync(join(contractRoot, name), "utf8");

const runCli = async (
  argumentsList: readonly string[],
  target?: string,
): Promise<Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>> => {
  const processConfiguration = officialGatewayProcessArguments(
    [process.execPath, "dist/collector.js", ...argumentsList],
    target,
  );
  const child = Bun.spawn(processConfiguration.argumentsList, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...officialGatewayProcessEnvironment(processConfiguration.target),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(decoder.decode(build.stderr));
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("trajectory world public process boundary", () => {
  test("prints world help without contacting a registry", async () => {
    // Given
    const result = await runCli(["world", "--help"]);

    // When / Then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("trajectory world");
  });

  test("requests exact catalog and detail paths with no authorization", async () => {
    // Given
    const observed: Array<Readonly<{ readonly authorization: string | null; readonly path: string }>> = [];
    const server = Bun.serve({
      fetch(request) {
        const path = new URL(request.url).pathname;
        observed.push({ authorization: request.headers.get("authorization"), path });
        if (path === "/v1/marketplace/worlds") {
          return new Response(fixture("catalog-list-200.json"), {
            headers: { "content-type": "application/json" },
          });
        }
        if (path === "/v1/marketplace/worlds/world/refund-unit") {
          return new Response(fixture("catalog-detail-200.json"), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(fixture("catalog-error-404.json"), {
          headers: { "content-type": "application/json" },
          status: 404,
        });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    // When
    const list = await runCli(["world", "list"], base);
    const detail = await runCli(["world", "detail", "world/refund-unit"], base);

    // Then
    expect(observed).toEqual([
      { authorization: null, path: "/v1/marketplace/worlds" },
      { authorization: null, path: "/v1/marketplace/worlds/world/refund-unit" },
    ]);
    expect([list, detail]).toEqual([
      { exitCode: 0, stderr: "", stdout: fixture("catalog-list-200.json") },
      { exitCode: 0, stderr: "", stdout: fixture("catalog-detail-200.json") },
    ]);
  });

  test("uses protected identities and exact hosted/download requests", async () => {
    // Given
    const observed: Array<Readonly<{ readonly body: string; readonly headers: Readonly<Record<string, string | null>>; readonly method: string; readonly path: string }>> = [];
    const hosted = JSON.stringify({
      ok: true,
      result: { instanceId, packDigest, revision: 0, status: "active", worldId },
    });
    const server = Bun.serve({
      async fetch(request) {
        const path = new URL(request.url).pathname;
        observed.push({
          body: await request.text(),
          headers: {
            authorization: request.headers.get("authorization"),
            digest: request.headers.get("x-world-pack-digest"),
            idempotency: request.headers.get("idempotency-key"),
          },
          method: request.method,
          path,
        });
        if (path.endsWith("/downloads")) {
          return new Response(fixture("entitlement-download-200.json"), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(hosted, { headers: { "content-type": "application/json" } });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const common = ["--api-key", "api-token"];
    const run = [
      "world", "run", worldId, ...common, "--contract-id", contractId,
      "--pack-digest", packDigest, "--seed", "7", "--idempotency-key", "run-7",
    ];
    const status = [
      "world", "status", worldId, instanceId, ...common, "--contract-id",
      contractId, "--pack-digest", packDigest,
    ];

    // When
    const runResult = await runCli(run, base);
    const statusResult = await runCli(status, base);
    const downloadResult = await runCli(["world", "download", entitlementId, ...common], base);

    // Then
    const hostedPath = `/v1/marketplace/buyer/world-contracts/${contractId}/hosted/instances`;
    expect(observed).toEqual([
      {
        body: "{\"seed\":7}",
        headers: { authorization: "Bearer api-token", digest: packDigest, idempotency: "run-7" },
        method: "POST",
        path: hostedPath,
      },
      {
        body: "",
        headers: { authorization: "Bearer api-token", digest: packDigest, idempotency: null },
        method: "GET",
        path: `${hostedPath}/${instanceId}`,
      },
      {
        body: "",
        headers: { authorization: "Bearer api-token", digest: null, idempotency: null },
        method: "POST",
        path: `/v1/marketplace/buyer/world-entitlements/${entitlementId}/downloads`,
      },
    ]);
    expect([runResult, statusResult, downloadResult]).toEqual([
      { exitCode: 0, stderr: "", stdout: `${hosted}\n` },
      { exitCode: 0, stderr: "", stdout: `${hosted}\n` },
      { exitCode: 0, stderr: "", stdout: fixture("entitlement-download-200.json") },
    ]);
  });

  test("fails closed for a mismatched pack, incompatible runtime, and unauthorized download", async () => {
    // Given
    const mismatchedDigest = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const server = Bun.serve({
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/downloads")) return new Response(null, { status: 401 });
        if (request.headers.get("x-world-pack-digest") === mismatchedDigest) {
          return new Response(JSON.stringify({
            ok: true,
            result: { instanceId, packDigest, revision: 0, status: "active", worldId },
          }), { headers: { "content-type": "application/json" } });
        }
        return new Response(null, { status: 422 });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const run = (digest: string) => [
      "world", "run", worldId, "--api-key", "api-token",
      "--contract-id", contractId, "--pack-digest", digest, "--seed", "7",
      "--idempotency-key", `run-${digest.slice(0, 4)}`,
    ];

    // When
    const results = await Promise.all([
      runCli(run(mismatchedDigest), base),
      runCli(run(packDigest), base),
      runCli(["world", "download", entitlementId, "--api-key", "api-token"], base),
    ]);

    // Then
    expect(results).toEqual([
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"invalid_response\",\"message\":\"invalid_response\"}}\n", stdout: "" },
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"incompatible\",\"message\":\"incompatible\"}}\n", stdout: "" },
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"unauthorized\",\"message\":\"unauthorized\"}}\n", stdout: "" },
    ]);
  });
});
