import { expect, test } from "bun:test";
import worker from "../../../infra/cloudflare/marketplace-apex/index.js";

const railwayOrigin = "https://marketplace-web-production-production.up.railway.app";

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
