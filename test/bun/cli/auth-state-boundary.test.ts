import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { officialRegistryOrigin } from "../../../src/auth/official-origin";
import { readStoredAuthSession, writeStoredAuthSession } from "../../../src/auth/store";
import { runAuthCli } from "../../../src/cli/auth";

const token = "state-boundary-access-token";
const accountId = "acct-0123456789abcdef";
const expiresAt = "2099-07-25T00:00:00.000Z";
const roots: string[] = [];
const nativeFetch = globalThis.fetch;
const nativeLog = console.log;

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-auth-state-"));
  roots.push(root);
  return root;
};

const session = () => ({
  accessToken: token,
  accountId,
  expiresAt,
  server: officialRegistryOrigin,
  tokenType: "Bearer" as const,
});

const installFetch = (
  handler: (request: Request) => Promise<Response>,
): void => {
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    handler(input instanceof Request ? input : new Request(input.toString(), init));
  fetch.preconnect = nativeFetch.preconnect;
  globalThis.fetch = fetch;
};

afterEach(() => {
  globalThis.fetch = nativeFetch;
  console.log = nativeLog;
  delete process.env.TRAJECTORY_MARKETPLACE_CONFIG_HOME;
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("auth credential state boundary", () => {
  test("preserves credentials when remote logout is rate limited", async () => {
    const root = fixtureRoot();
    process.env.TRAJECTORY_MARKETPLACE_CONFIG_HOME = root;
    writeStoredAuthSession(session());
    installFetch(async (request) => {
      expect({ method: request.method, url: request.url }).toEqual({
        method: "POST",
        url: `${officialRegistryOrigin}/v1/auth/logout`,
      });
      return Response.json(
        { ok: false, error: { code: "rate_limited", message: "later" } },
        { status: 429 },
      );
    });

    const result = runAuthCli(["auth", "logout"], AbortSignal.timeout(1_000));

    expect(result).rejects.toMatchObject({ code: "rate_limited", name: "AuthClientError" });
    await result.catch(() => undefined);
    expect(String(readStoredAuthSession(officialRegistryOrigin)?.accessToken)).toBe(token);
  });

  test("clears credentials when account status is unauthorized", async () => {
    const root = fixtureRoot();
    process.env.TRAJECTORY_MARKETPLACE_CONFIG_HOME = root;
    writeStoredAuthSession(session());
    const output: string[] = [];
    console.log = (value?: unknown) => output.push(String(value));
    installFetch(async (request) => {
      expect({ method: request.method, url: request.url }).toEqual({
        method: "GET",
        url: `${officialRegistryOrigin}/v1/auth/me`,
      });
      return Response.json(
        { ok: false, error: { code: "unauthorized", message: "later" } },
        { status: 401 },
      );
    });

    await runAuthCli(["auth", "status"], AbortSignal.timeout(1_000));

    expect(output.map((value) => JSON.parse(value))).toEqual([
      { authenticated: false, server: officialRegistryOrigin },
    ]);
    expect(readStoredAuthSession(officialRegistryOrigin)).toBeUndefined();
  });
});
