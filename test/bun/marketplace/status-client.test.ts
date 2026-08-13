import { afterEach, describe, expect, test } from "bun:test";
import type { KyInstance } from "ky";

import {
  createStatusClient,
  StatusClientError,
} from "../../../src/marketplace/status-client";

const submissionId = "sub_00000000000000000000000000";
const credential =
  "trk_0123456789abcdef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const servers: Bun.Server<undefined>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

const serverUrl = (
  handler: (request: Request) => Response | Promise<Response>,
): string => {
  const server = Bun.serve({ fetch: handler, port: 0 });
  servers.push(server);
  return server.url.toString().replace(/\/$/, "");
};

describe("candidate status client", () => {
  test.each(["accepted", "processing", "completed", "rejected"] as const)(
    "reads the frozen %s status contract with bearer auth",
    async (status) => {
    let observedPath = "";
    let observedAuthorization = "";
    const origin = serverUrl((request) => {
      const url = new URL(request.url);
      observedPath = url.pathname;
      observedAuthorization = request.headers.get("authorization") ?? "";
      return Response.json({
        protocolVersion: 1,
        submissionId,
        status,
      });
    });

    const result = await createStatusClient(origin).read({
      credential,
      submissionId,
    });

    expect(result.protocolVersion).toBe(1);
    expect(result.status).toBe(status);
    expect(String(result.submissionId)).toBe(submissionId);
    expect(observedPath).toBe(
      `/v1/marketplace/seller/candidates/${submissionId}`,
    );
    expect(observedAuthorization).toStartWith("Bearer trk_");
    },
  );

  test("surfaces auth and account-scoped errors without following redirects", async () => {
    const unauthorizedOrigin = serverUrl(
      () =>
        new Response(
          JSON.stringify({ protocolVersion: 1, code: "unauthorized" }),
          { status: 401 },
        ),
    );
    const notFoundOrigin = serverUrl(
      () =>
        new Response(
          JSON.stringify({ protocolVersion: 1, code: "not_found" }),
          { status: 404 },
        ),
    );
    const redirectOrigin = serverUrl(
      () => new Response(null, { headers: { location: "https://example.test" }, status: 302 }),
    );
    const request = {
      credential,
      submissionId,
    } as const;

    await expect(createStatusClient(unauthorizedOrigin).read(request)).rejects.toEqual(
      new StatusClientError("unauthorized"),
    );
    await expect(createStatusClient(notFoundOrigin).read(request)).rejects.toEqual(
      new StatusClientError("not_found"),
    );
    await expect(createStatusClient(redirectOrigin).read(request)).rejects.toEqual(
      new StatusClientError("unavailable"),
    );
  });

  test("cancels a redirect response body before rejecting it", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { location: "https://example.test" }, status: 302 },
    );
    const requestClient = {
      get: async () => response,
    } as unknown as KyInstance;

    await expect(
      createStatusClient("https://gateway.getatm.io", { requestClient }).read({
        credential,
        submissionId,
      }),
    ).rejects.toEqual(new StatusClientError("unavailable"));
    expect(cancelled).toBe(true);
  });

  test("rejects a status response for a different submission", async () => {
    const origin = serverUrl(() =>
      Response.json({
        protocolVersion: 1,
        submissionId: "sub_11111111111111111111111111",
        status: "completed",
      }),
    );

    await expect(
      createStatusClient(origin).read({ credential, submissionId }),
    ).rejects.toEqual(new StatusClientError("invalid_response"));
  });

  test("rejects chunked responses immediately after the byte cap", async () => {
    const origin = serverUrl(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(131_072));
            },
          }),
        ),
    );

    await expect(
      createStatusClient(origin).read({ credential, submissionId }),
    ).rejects.toEqual(new StatusClientError("invalid_response"));
  });

  test("rejects malformed response JSON", async () => {
    const origin = serverUrl(() => new Response("{not-json"));

    await expect(
      createStatusClient(origin).read({ credential, submissionId }),
    ).rejects.toEqual(new StatusClientError("invalid_response"));
  });

  test("preserves caller cancellation separately from timeout", async () => {
    const caller = new AbortController();
    caller.abort();
    await expect(
      createStatusClient("http://127.0.0.1:9").read({
        credential,
        signal: caller.signal,
        submissionId,
      }),
    ).rejects.toEqual(new StatusClientError("cancelled"));

    const origin = serverUrl(() => new Promise<Response>(() => {}));
    await expect(
      createStatusClient(origin, { timeoutMilliseconds: 10 }).read({
        credential,
        submissionId,
      }),
    ).rejects.toEqual(new StatusClientError("timeout"));
  });
});
