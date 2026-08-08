// Local preview server for the static marketplace UI. Run: bun web/server.ts
const root = new URL(".", import.meta.url).pathname;
const port = Number(Bun.env.PORT ?? 4173);

const pages: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/detail.html": "detail.html",
};

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const page = pages[pathname];
    if (page === undefined) return new Response("not found", { status: 404 });
    const file = Bun.file(`${root}${page}`);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`marketplace ui: http://localhost:${port}/`);
