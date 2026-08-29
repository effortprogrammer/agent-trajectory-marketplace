import { createPreviewFetch } from "./preview-server";

const root = new URL(".", import.meta.url).pathname;
const port = Number(Bun.env.PORT ?? 4188);

const server = Bun.serve({
	port,
	fetch: createPreviewFetch(root),
});

console.log(`ATM shadcn preview: http://localhost:${server.port}/`);
