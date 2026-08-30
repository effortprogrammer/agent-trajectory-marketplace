export type ProbeConfig = {
  readonly registryUrl: string;
  readonly marketplaceUrl: string;
  readonly expectedRegistryRevision: string;
  readonly expectedMarketplaceRevision: string;
  readonly timeoutMs?: number;
};
export type ProbeResult = { readonly ok: true; readonly checks: 8 };
const REVISION = /^[0-9a-f]{40}$/;
const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid JSON object");
  const result = value as Record<string, unknown>;
  check(Object.keys(result).length === keys.length && keys.every((key) => key in result), "unexpected JSON shape");
  return result;
};
const request = async (base: string, path: string, timeoutMs: number): Promise<Response> => fetch(new URL(path, `${base.replace(/\/$/, "")}/`), { signal: AbortSignal.timeout(timeoutMs) });
const json = async (base: string, path: string, timeoutMs: number, status = 200): Promise<{ readonly response: Response; readonly value: unknown }> => {
  const response = await request(base, path, timeoutMs);
  check(response.status === status, `${path}: HTTP ${response.status}`);
  return { response, value: await response.json() };
};
const revision = async (base: string, path: string, header: string, expected: string, timeoutMs: number): Promise<void> => {
  const result = await json(base, path, timeoutMs);
  const value = object(result.value, ["revision"]);
  check(typeof value["revision"] === "string" && REVISION.test(value["revision"]) && value["revision"] === expected, `${path}: revision mismatch`);
  check(result.response.headers.get(header) === expected, `${path}: revision header mismatch`);
};
export async function runProbe(config: ProbeConfig): Promise<ProbeResult> {
  const timeoutMs = config.timeoutMs ?? 3_000;
  const health = await json(config.registryUrl, "/health", timeoutMs);
  check(object(health.value, ["status"])["status"] === "ok", "registry health is not ok");
  const ready = await json(config.registryUrl, "/ready", timeoutMs);
  check(object(ready.value, ["ready"])["ready"] === true, "registry is not ready");
  check(REVISION.test(config.expectedRegistryRevision), "expected registry revision is not a SHA");
  check(REVISION.test(config.expectedMarketplaceRevision), "expected marketplace revision is not a SHA");
  await revision(config.registryUrl, "/.well-known/atm-origin-revision", "x-atm-origin-revision", config.expectedRegistryRevision, timeoutMs);
  await revision(config.marketplaceUrl, "/.well-known/atm-origin-revision", "x-atm-origin-revision", config.expectedMarketplaceRevision, timeoutMs);
  await revision(config.marketplaceUrl, "/.well-known/atm-worker-revision", "x-atm-worker-revision", config.expectedMarketplaceRevision, timeoutMs);
  const payout = await request(config.registryUrl, "/v1/marketplace/seller/payout-request", timeoutMs);
  check(payout.status === 401, "payout route must return 401");
  check(payout.headers.get("cache-control") === "no-store", "payout cache policy mismatch");
  const payoutMediaType = payout.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  check(payoutMediaType === "application/json", "payout content type mismatch");
  const envelope = object(await payout.json(), ["ok", "error"]);
  check(envelope["ok"] === false, "payout ok mismatch");
  const error = object(envelope["error"], ["code", "message"]);
  check(error["code"] === "unauthorized" && error["message"] === "Authentication is required.", "payout envelope mismatch");
  return { ok: true, checks: 8 };
}
if (import.meta.main) { // no-excuse-ok: catch
  try { await runProbe({ registryUrl: process.env["REGISTRY_URL"] ?? "", marketplaceUrl: process.env["MARKETPLACE_URL"] ?? "", expectedRegistryRevision: process.env["EXPECTED_REGISTRY_REVISION"] ?? "", expectedMarketplaceRevision: process.env["EXPECTED_MARKETPLACE_REVISION"] ?? "" }); console.log("marketplace probe passed"); }
  catch (error) { console.error(error instanceof Error ? error.message : "marketplace probe failed"); process.exitCode = 1; }
}
