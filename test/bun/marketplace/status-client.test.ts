import { afterEach, describe, expect, test } from "bun:test";

import {
  createStatusClient,
  StatusClientError,
} from "../../../src/marketplace/status-client";

const submissionId = "sub_00000000000000000000000000";
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
  test("reads the frozen status contract with bearer auth", async () => {
    let observedPath = "";
    let observedAuthorization = "";
    const origin = serverUrl((request) => {
      const url = new URL(request.url);
      observedPath = url.pathname;
      observedAuthorization = request.headers.get("authorization") ?? "";
      return Response.json({
        protocolVersion: 1,
        submissionId,
        status: "processing",
      });
    });

    const result = await createStatusClient(origin).read({
      credential:
        "trk_0123456789abcdef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      submissionId,
    });

    expect(result.protocolVersion).toBe(1);
    expect(result.status).toBe("processing");
    expect(String(result.submissionId)).toBe(submissionId);
    expect(observedPath).toBe(
      `/v1/marketplace/seller/candidates/${submissionId}`,
    );
    expect(observedAuthorization).toStartWith("Bearer trk_");
  });

  test("surfaces account-scoped not found without following redirects", async () => {
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
      credential:
        "trk_0123456789abcdef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      submissionId,
    } as const;

    await expect(createStatusClient(notFoundOrigin).read(request)).rejects.toEqual(
      new StatusClientError("not_found"),
    );
    await expect(createStatusClient(redirectOrigin).read(request)).rejects.toEqual(
      new StatusClientError("unavailable"),
    );
  });
});
