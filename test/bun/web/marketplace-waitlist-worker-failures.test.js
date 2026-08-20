import { expect, test } from "bun:test";
import { handleWaitlist } from "../../../infra/cloudflare/marketplace-apex/waitlist.js";

const edgeSecret = "waitlist-worker-test-edge-secret-0001";

const request = () =>
  new Request("https://getatm.io/api/waitlist", {
    body: JSON.stringify({
      acceptContact: true,
      email: "person@example.test",
    }),
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "content-type": "application/json",
    },
    method: "POST",
  });

const dependencies = (fetcher) => ({
  fetcher,
  nonce: () => "00000000-0000-4000-8000-000000000001",
  now: () => 1_787_054_400_000,
  timeoutSignal: () => new AbortController().signal,
});

test("contains Registry response-stream failures as bad gateway responses", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error("upstream body failed"));
    },
  });

  const response = await handleWaitlist(
    request(),
    { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    dependencies(async () => new Response(stream, { status: 202 })),
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: {
      code: "bad_gateway",
      message: "waitlist request failed",
    },
  });
});

test("rejects oversized Registry response bodies", async () => {
  const response = await handleWaitlist(
    request(),
    { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    dependencies(
      async () =>
        new Response(JSON.stringify({ padding: "x".repeat(4_097) }), {
          headers: { "content-type": "application/json" },
          status: 202,
        }),
    ),
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: {
      code: "bad_gateway",
      message: "waitlist request failed",
    },
  });
});

test("maps an aborted Registry fetch to gateway timeout", async () => {
  const response = await handleWaitlist(
    request(),
    { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    dependencies(async () => {
      throw new DOMException("request timed out", "AbortError");
    }),
  );

  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({
    error: {
      code: "gateway_timeout",
      message: "waitlist request timed out",
    },
  });
});
