import { expect, test } from "bun:test";
import { createPreviewFetch, previewAssets } from "./preview-server";

const root = new URL(".", import.meta.url).pathname;
const handle = createPreviewFetch(root);

for (const [pathname, asset] of Object.entries(previewAssets)) {
	test(`serves ${pathname} with its declared content type`, async () => {
		const response = await handle(new Request(`http://localhost${pathname}`));

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(asset.type);
	});
}

test("returns an empty favicon response", async () => {
	const response = await handle(new Request("http://localhost/favicon.ico"));

	expect(response.status).toBe(204);
	expect(await response.text()).toBe("");
});

test("rejects paths outside the preview allowlist", async () => {
	const response = await handle(new Request("http://localhost/not-found"));

	expect(response.status).toBe(404);
});

for (const pathname of ["/components.js", "/landing-sections.js"]) {
	test(`does not serve retired remote-module entry ${pathname}`, async () => {
		const response = await handle(new Request(`http://localhost${pathname}`));

		expect(response.status).toBe(404);
	});
}
