const target = process.env.TRAJECTORY_TEST_GATEWAY_TARGET;

if (target !== undefined) {
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
    const targetUrl = new URL(target);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;
    return nativeFetch(new Request(targetUrl.toString(), request));
  };
  gatewayFetch.preconnect = nativeFetch.preconnect;
  globalThis.fetch = gatewayFetch;
}
