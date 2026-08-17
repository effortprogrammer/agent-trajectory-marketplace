// Local preview server for the static marketplace UI. Run: bun web/server.ts
const root = new URL(".", import.meta.url).pathname;
const port = Number(Bun.env.PORT ?? 4173);
const canonicalOrigin = "https://getatm.io";
const legacyMarketplaceHost = "marketplace.getatm.io";
const securityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' https://gateway.getatm.io",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

const assets: Readonly<Record<string, Readonly<{ file: string; type: string }>>> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/marketplace.css": { file: "marketplace.css", type: "text/css; charset=utf-8" },
  "/marketplace.js": { file: "marketplace.js", type: "text/javascript; charset=utf-8" },
  "/robots.txt": { file: "robots.txt", type: "text/plain; charset=utf-8" },
};

const compatibilityRedirect = (url: URL): Response | undefined => {
  if (url.pathname === "/detail.html") {
    return new Response(null, {
      headers: { ...securityHeaders, location: "/index.html" },
      status: 302,
    });
  }

  const legacyView = url.searchParams.get("view") === "world";
  if (!legacyView) return undefined;

  return new Response(null, {
    headers: { ...securityHeaders, location: "/index.html" },
    status: 302,
  });
};

const canonicalHostRedirect = (url: URL): Response | undefined => {
  if (url.hostname !== legacyMarketplaceHost) return undefined;

  const canonicalUrl = new URL(canonicalOrigin);
  canonicalUrl.pathname = url.pathname;
  canonicalUrl.search = url.search;
  return new Response(null, {
    headers: { ...securityHeaders, location: canonicalUrl.toString() },
    status: 301,
  });
};

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    const canonicalRedirect = canonicalHostRedirect(url);
    if (canonicalRedirect) return canonicalRedirect;
    if (pathname === "/favicon.ico") {
      return new Response(null, { headers: securityHeaders, status: 204 });
    }
    const redirect = compatibilityRedirect(url);
    if (redirect) return redirect;

    const asset = assets[pathname];
    if (asset === undefined) {
      return new Response("not found", { headers: securityHeaders, status: 404 });
    }
    const file = Bun.file(`${root}${asset.file}`);
    if (!(await file.exists())) {
      return new Response("not found", { headers: securityHeaders, status: 404 });
    }
    return new Response(file, {
      headers: {
        ...securityHeaders,
        "cache-control": asset.file === "index.html" ? "no-store" : "public, max-age=300",
        "content-type": asset.type,
      },
    });
  },
});

console.log(`marketplace ui: http://localhost:${port}/`);
