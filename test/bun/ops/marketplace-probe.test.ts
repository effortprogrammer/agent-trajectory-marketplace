import { describe, expect, test } from "bun:test";
import { runProbe } from "../../../scripts/ops/marketplace-probe";
const SHA = "0123456789abcdef0123456789abcdef01234567";
type Failure = "none" | "readiness" | "registry" | "origin" | "worker" | "headers" | "shape" | "payout";
const start = (failure: Failure): Bun.Server<undefined> => Bun.serve({ port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  const revision = path.includes("worker") ? (failure === "worker" ? "f".repeat(40) : SHA) : (failure === "registry" || failure === "origin" ? "f".repeat(40) : SHA);
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (path.includes("revision")) headers.set(path.includes("worker") ? "x-atm-worker-revision" : "x-atm-origin-revision", failure === "headers" ? "f".repeat(40) : revision);
  if (path === "/v1/marketplace/seller/payout-request") {
    if (failure === "payout") return Response.json({ ok: true }, { status: 200 });
    headers.set("cache-control", "no-store"); return new Response(JSON.stringify(failure === "shape" ? { ok: false } : { ok: false, error: { code: "unauthorized", message: "Authentication is required." } }), { status: 401, headers });
  }
  if (path === "/health") return Response.json({ status: "ok" });
  if (path === "/ready") return Response.json({ ready: failure !== "readiness" });
  if (path.includes("revision")) return new Response(JSON.stringify({ revision }), { headers });
  return new Response("not found", { status: 404 });
} });
const config = (port: number) => ({ registryUrl: `http://localhost:${port}`, marketplaceUrl: `http://localhost:${port}`, expectedRegistryRevision: SHA, expectedMarketplaceRevision: SHA });
describe("marketplace beta health probe", () => {
  test("passes exact canonical contracts", async () => { const server = start("none"); try { expect(await runProbe(config(Number(server.port)))).toEqual({ ok: true, checks: 8 }); } finally { server.stop(); } });
  for (const failure of ["readiness", "registry", "origin", "worker", "headers", "shape", "payout"] as const) test(`rejects ${failure}`, async () => { const server = start(failure); try { expect(runProbe(config(Number(server.port)))).rejects.toThrow(); } finally { server.stop(); } });
  test("pins scheduled probe actions", async () => {
    const workflow = await Bun.file(".github/workflows/ops-probe.yml").text();
    expect(workflow).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
    expect(workflow).toContain("oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6");
    expect(workflow).not.toContain("actions/checkout@v");
    expect(workflow).not.toContain("oven-sh/setup-bun@v");
  });
});
