// Local preview server for the static marketplace UI. Run: bun web/server.ts
const root = new URL(".", import.meta.url).pathname;
const port = Number(Bun.env.PORT ?? 4173);
const canonicalOrigin = "https://getatm.io";
const legacyMarketplaceHost = "marketplace.getatm.io";
const originRevisionPattern = /^[a-f0-9]{40}$/;
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

type Asset = Readonly<{
  cacheControl: string;
  file: string;
  type: string;
}>;

const assets = new Map<string, Asset>([
  ["/", { cacheControl: "no-store", file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { cacheControl: "no-store", file: "index.html", type: "text/html; charset=utf-8" }],
  ["/robots.txt", { cacheControl: "public, max-age=300", file: "robots.txt", type: "text/plain; charset=utf-8" }],
]);

const fingerprintedAssetSpecs = [
  { file: "marketplace.css", type: "text/css; charset=utf-8" },
  { file: "marketplace.js", type: "text/javascript; charset=utf-8" },
  { file: "console.css", type: "text/css; charset=utf-8" },
  { file: "console.js", type: "text/javascript; charset=utf-8" },
  { file: "console-contract.js", type: "text/javascript; charset=utf-8" },
] as const;

for (const asset of fingerprintedAssetSpecs) {
  const extensionOffset = asset.file.lastIndexOf(".");
  if (extensionOffset <= 0) throw new Error(`asset has no extension: ${asset.file}`);
  const bytes = await Bun.file(`${root}${asset.file}`).arrayBuffer();
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const path = `/${asset.file.slice(0, extensionOffset)}.${digest}${asset.file.slice(extensionOffset)}`;
  assets.set(path, {
    cacheControl: "public, max-age=31536000, immutable",
    file: asset.file,
    type: asset.type,
  });
}

const notFound = (): Response =>
  new Response("not found", {
    headers: { ...securityHeaders, "cache-control": "no-store" },
    status: 404,
  });

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
    if (pathname === "/.well-known/atm-origin-revision") {
      const revision = Bun.env.RAILWAY_GIT_COMMIT_SHA ?? "";
      if (!originRevisionPattern.test(revision)) {
        return Response.json(
          { error: "unavailable" },
          {
            headers: { ...securityHeaders, "cache-control": "no-store" },
            status: 503,
          },
        );
      }
      return Response.json(
        { revision },
        {
          headers: {
            ...securityHeaders,
            "cache-control": "no-store",
            "x-atm-origin-revision": revision,
          },
        },
      );
    }
    if (pathname === "/favicon.ico") {
      return new Response(null, { headers: securityHeaders, status: 204 });
    }
    const redirect = compatibilityRedirect(url);
    if (redirect) return redirect;

    const asset = url.search === "" ? assets.get(pathname) : undefined;
    if (asset === undefined) return notFound();
    const file = Bun.file(`${root}${asset.file}`);
    if (!(await file.exists())) return notFound();
    return new Response(file, {
      headers: {
        ...securityHeaders,
        "cache-control": asset.cacheControl,
        "content-type": asset.type,
      },
    });
  },
});

console.log(`marketplace ui: http://localhost:${port}/`);
