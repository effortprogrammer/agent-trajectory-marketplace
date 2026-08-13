const target = process.env.TRAJECTORY_TEST_GATEWAY_TARGET;
const staticResponse = process.env.TRAJECTORY_TEST_GATEWAY_STATIC_RESPONSE;

if (target !== undefined || staticResponse !== undefined) {
  const nativeFetch = globalThis.fetch;
  const gatewayFetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request
      ? input
      : new Request(input.toString(), init);
    const url = new URL(request.url);
    if (url.origin !== "https://gateway.getatm.io") {
      return nativeFetch(request);
    }
    if (staticResponse === "auth-logout-rate-limited") {
      if (request.method !== "POST" || url.pathname !== "/v1/auth/logout") {
        throw new Error("unexpected static gateway request");
      }
      return Promise.resolve(Response.json(
        { ok: false, error: { code: "rate_limited", message: "later" } },
        { status: 429 },
      ));
    }
    if (staticResponse === "auth-me-unauthorized") {
      if (request.method !== "GET" || url.pathname !== "/v1/auth/me") {
        throw new Error("unexpected static gateway request");
      }
      return Promise.resolve(Response.json(
        { ok: false, error: { code: "unauthorized", message: "later" } },
        { status: 401 },
      ));
    }
    if (target === undefined) throw new Error("invalid static gateway response");
    const targetUrl = new URL(target);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;
    const targetRequest = new Request(targetUrl.toString(), request);
    targetRequest.headers.set("connection", "close");
    return nativeFetch(targetRequest);
  };
  gatewayFetch.preconnect = nativeFetch.preconnect;
  globalThis.fetch = gatewayFetch;
}
