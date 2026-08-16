// Local preview server for the static marketplace UI. Run: bun web/server.ts
const root = new URL(".", import.meta.url).pathname;
const port = Number(Bun.env.PORT ?? 4173);

const assets: Readonly<Record<string, Readonly<{ file: string; type: string }>>> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/marketplace.css": { file: "marketplace.css", type: "text/css; charset=utf-8" },
  "/marketplace.js": { file: "marketplace.js", type: "text/javascript; charset=utf-8" },
};

const compatibilityRedirect = (url: URL): Response | undefined => {
  if (url.pathname === "/detail.html") {
    return new Response(null, { headers: { location: "/index.html" }, status: 302 });
  }

  const legacyView = url.searchParams.get("view") === "world";
  if (!legacyView) return undefined;

  return new Response(null, { headers: { location: url.pathname }, status: 302 });
};

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const redirect = compatibilityRedirect(url);
    if (redirect) return redirect;

    const asset = assets[pathname];
    if (asset === undefined) return new Response("not found", { status: 404 });
    const file = Bun.file(`${root}${asset.file}`);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "content-type": asset.type } });
  },
});

console.log(`marketplace ui: http://localhost:${port}/`);
