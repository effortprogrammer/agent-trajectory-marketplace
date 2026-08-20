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

const dependencies = (fetcher, requestBodyTimeoutSignal = () => new AbortController().signal) => ({
  fetcher,
  nonce: () => "00000000-0000-4000-8000-000000000001",
  now: () => 1_787_054_400_000,
  requestBodyTimeoutSignal,
  timeoutSignal: () => new AbortController().signal,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

test("cancels a stalled inbound request body and returns a bounded timeout", async () => {
  const reading = deferred();
  const cancelled = deferred();
  const timeout = new AbortController();
  let fetchCalled = false;
  const stream = new ReadableStream({
    pull() {
      reading.resolve();
    },
    cancel() {
      cancelled.resolve();
    },
  });
  const stalledRequest = new Request("https://getatm.io/api/waitlist", {
    body: stream,
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "content-type": "application/json",
    },
    method: "POST",
  });

  const responsePromise = handleWaitlist(
    stalledRequest,
    { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    dependencies(async () => {
      fetchCalled = true;
      return new Response("unexpected");
    }, () => timeout.signal),
  );

  await reading.promise;
  timeout.abort();

  const response = await responsePromise;
  await cancelled.promise;
  expect(response.status).toBe(408);
  expect(await response.json()).toEqual({
    error: {
      code: "request_timeout",
      message: "request timed out",
    },
  });
  expect(fetchCalled).toBe(false);
});

test("returns an oversized-body response without awaiting stream cancellation", async () => {
  const cancelStarted = deferred();
  const releaseCancel = deferred();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4_097));
    },
    cancel() {
      cancelStarted.resolve();
      return releaseCancel.promise;
    },
  });
  const oversizedRequest = new Request("https://getatm.io/api/waitlist", {
    body: stream,
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "content-type": "application/json",
    },
    method: "POST",
  });

  const responsePromise = handleWaitlist(
    oversizedRequest,
    { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    dependencies(async () => new Response("unexpected")),
  );

  await cancelStarted.promise;
  try {
    const outcome = await Promise.race([
      responsePromise.then((response) => ({ kind: "response", response })),
      new Promise((resolve) => setImmediate(() => resolve({ kind: "pending" }))),
    ]);

    expect(outcome.kind).toBe("response");
    if (outcome.kind === "response") {
      expect(outcome.response.status).toBe(413);
    }
  } finally {
    releaseCancel.resolve();
  }
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
