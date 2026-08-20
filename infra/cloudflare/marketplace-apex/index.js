import { handleWaitlist } from "./waitlist.js";

const RAILWAY_ORIGIN = "https://marketplace-web-production-production.up.railway.app";
const CANONICAL_ORIGIN = "https://getatm.io";
const HSTS = "max-age=31536000; includeSubDomains";
const READ_METHODS = new Set(["GET", "HEAD"]);
const WAITLIST_PATH = "/api/waitlist";
const FORWARDED_HEADERS = [
  "accept",
  "accept-language",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "range",
  "user-agent",
];

export default {
  async fetch(request, environment) {
    const incomingUrl = new URL(request.url);
    if (incomingUrl.protocol !== "https:") {
      const redirectUrl = new URL(CANONICAL_ORIGIN);
      redirectUrl.pathname = incomingUrl.pathname;
      redirectUrl.search = incomingUrl.search;
      return new Response(null, {
        headers: {
          "cache-control": "no-store",
          location: redirectUrl.toString(),
          "strict-transport-security": HSTS,
        },
        status: 308,
      });
    }

    if (incomingUrl.pathname === WAITLIST_PATH) {
      return handleWaitlist(request, environment);
    }

    if (!READ_METHODS.has(request.method)) {
      return new Response("method not allowed", {
        headers: {
          allow: "GET, HEAD",
          "cache-control": "no-store",
          "strict-transport-security": HSTS,
        },
        status: 405,
      });
    }

    const upstreamUrl = new URL(RAILWAY_ORIGIN);
    upstreamUrl.pathname = incomingUrl.pathname;
    upstreamUrl.search = incomingUrl.search;
    const upstreamHeaders = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) upstreamHeaders.set(name, value);
    }
    const upstreamRequest = new Request(upstreamUrl, {
      headers: upstreamHeaders,
      method: request.method,
      redirect: "manual",
    });
    const upstreamResponse = await fetch(upstreamRequest);
    const headers = new Headers(upstreamResponse.headers);
    const location = headers.get("location");
    const cacheControl = headers.get("cache-control");

    headers.set("cache-control", cacheControl ? `${cacheControl}, no-transform` : "no-transform");
    headers.set("strict-transport-security", HSTS);
    headers.delete("set-cookie");

    if (location) {
      const redirectUrl = new URL(location, RAILWAY_ORIGIN);
      if (redirectUrl.origin === RAILWAY_ORIGIN) {
        redirectUrl.protocol = incomingUrl.protocol;
        redirectUrl.host = incomingUrl.host;
        headers.set("location", redirectUrl.toString());
      }
    }

    return new Response(upstreamResponse.body, {
      headers,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    });
  },
};
