import { expect, test } from "bun:test";
import fixture from "../../../contract/waitlist-edge/v1/fixture.json";
import worker from "../../../infra/cloudflare/marketplace-apex/index.js";
import { handleWaitlist } from "../../../infra/cloudflare/marketplace-apex/waitlist.js";

const railwayOrigin = "https://marketplace-web-production-production.up.railway.app";
const registryOrigin = "https://gateway.getatm.io";
const waitlistPath = "/v1/marketplace/waitlist";
const edgeSecret = "waitlist-worker-test-edge-secret-0001";

const hmacHex = async (secret, canonical) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  );
  return Buffer.from(signature).toString("hex");
};

test("matches the Registry-owned signing fixture exactly", async () => {
  let upstreamRequest;
  const response = await handleWaitlist(
    new Request("https://getatm.io/api/waitlist", {
      body: fixture.body,
      headers: {
        "cf-connecting-ip": fixture.source,
        "content-type": "application/json",
        "x-atm-waitlist-signature": "caller-controlled",
      },
      method: "POST",
    }),
    { REGISTRY_WAITLIST_EDGE_SECRET: fixture.testSecret },
    {
      fetcher: async (request) => {
        upstreamRequest = request;
        return Response.json({ ok: true, status: "accepted" }, { status: 202 });
      },
      nonce: () => fixture.nonce,
      now: () => Number(fixture.timestamp) * 1_000,
      timeoutSignal: () => new AbortController().signal,
    },
  );

  expect(response.status).toBe(202);
  expect(upstreamRequest.url).toBe(`${registryOrigin}${fixture.registryPath}`);
  expect(upstreamRequest.method).toBe(fixture.method);
  expect(upstreamRequest.headers.get("x-atm-waitlist-timestamp")).toBe(
    fixture.timestamp,
  );
  expect(upstreamRequest.headers.get("x-atm-waitlist-nonce")).toBe(fixture.nonce);
  expect(upstreamRequest.headers.get("x-atm-waitlist-source")).toBe(fixture.source);
  expect(upstreamRequest.headers.get("x-atm-waitlist-signature")).toBe(
    fixture.hmacSha256,
  );
  expect(await upstreamRequest.text()).toBe(fixture.body);
});

test.serial("signs bounded waitlist requests for the fixed Registry route", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (input) => {
    upstreamRequest = input instanceof Request ? input : new Request(input);
    return Response.json({ ok: true, status: "accepted" }, { status: 202 });
  };
  const body = JSON.stringify({
    acceptContact: true,
    email: "person@example.test",
  });

  try {
    const response = await worker.fetch(
      new Request("https://getatm.io/api/waitlist", {
        body,
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "content-type": "application/json",
          cookie: "must-not-forward=1",
        },
        method: "POST",
      }),
      { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    );

    expect(response.status).toBe(202);
    expect(upstreamRequest).toBeInstanceOf(Request);
    expect(upstreamRequest.url).toBe(`${registryOrigin}${waitlistPath}`);
    expect(upstreamRequest.method).toBe("POST");
    expect(upstreamRequest.headers.get("origin")).toBe("https://getatm.io");
    expect(upstreamRequest.headers.get("x-atm-waitlist-source")).toBe("203.0.113.9");
    expect(upstreamRequest.headers.get("cookie")).toBeNull();
    const timestamp = upstreamRequest.headers.get("x-atm-waitlist-timestamp");
    const nonce = upstreamRequest.headers.get("x-atm-waitlist-nonce");
    expect(timestamp).toMatch(/^[0-9]+$/);
    expect(nonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const bodyDigest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
    const canonical = [
      "POST",
      waitlistPath,
      timestamp,
      nonce,
      "203.0.113.9",
      bodyDigest,
    ].join("\n");
    expect(upstreamRequest.headers.get("x-atm-waitlist-signature")).toBe(
      await hmacHex(edgeSecret, canonical),
    );
    expect(await upstreamRequest.text()).toBe(body);
    expect(await response.json()).toEqual({ ok: true, status: "accepted" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("fails closed when the waitlist signing secret is missing", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  try {
    const response = await worker.fetch(
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
      }),
      {},
    );

    expect(response.status).toBe(503);
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("rejects oversized waitlist bodies before contacting Registry", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  try {
    const response = await worker.fetch(
      new Request("https://getatm.io/api/waitlist", {
        body: "x".repeat(4_097),
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { REGISTRY_WAITLIST_EDGE_SECRET: edgeSecret },
    );

    expect(response.status).toBe(413);
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("attests the deployed Worker revision without contacting the origin", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };
  const revision = "a".repeat(40);

  try {
    const response = await worker.fetch(
      new Request("https://getatm.io/.well-known/atm-worker-revision"),
      { WORKER_REVISION: revision },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-atm-worker-revision")).toBe(revision);
    expect(await response.json()).toEqual({ revision });
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("fails closed when the Worker revision is not an immutable commit SHA", async () => {
  const response = await worker.fetch(
    new Request("https://getatm.io/.well-known/atm-worker-revision"),
    { WORKER_REVISION: "unversioned" },
  );

  expect(response.status).toBe(503);
  expect(response.headers.get("x-atm-worker-revision")).toBeNull();
  expect(await response.json()).toEqual({
    error: {
      code: "service_unavailable",
      message: "worker revision is unavailable",
    },
  });
});

test.serial("rejects non-read Worker revision requests without contacting the origin", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  try {
    const response = await worker.fetch(
      new Request("https://getatm.io/.well-known/atm-worker-revision", {
        method: "POST",
      }),
      { WORKER_REVISION: "a".repeat(40) },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("keeps double-slash paths on the fixed Railway origin and strips credentials", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (input) => {
    upstreamRequest = input instanceof Request ? input : new Request(input);
    return new Response("marketplace", {
      headers: {
        "cache-control": "no-store",
        "set-cookie": "origin=must-not-forward",
      },
      status: 200,
    });
  };

  try {
    const response = await worker.fetch(new Request("https://getatm.io//attacker.example/payload", {
      headers: {
        accept: "text/html",
        authorization: "Bearer must-not-forward",
        cookie: "session=must-not-forward",
      },
    }));

    expect(upstreamRequest).toBeInstanceOf(Request);
    expect(new URL(upstreamRequest.url).origin).toBe(railwayOrigin);
    expect(new URL(upstreamRequest.url).pathname).toBe("//attacker.example/payload");
    expect(upstreamRequest.headers.get("accept")).toBe("text/html");
    expect(upstreamRequest.headers.get("authorization")).toBeNull();
    expect(upstreamRequest.headers.get("cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("set-cookie")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("rejects non-read methods without contacting the origin", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  try {
    const response = await worker.fetch(new Request("https://getatm.io/", {
      body: "sensitive",
      method: "POST",
    }));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.serial("redirects HTTP requests to the fixed HTTPS origin", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  try {
    const response = await worker.fetch(
      new Request("http://getatm.io//attacker.example/payload?ref=http"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://getatm.io//attacker.example/payload?ref=http",
    );
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(fetchCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
