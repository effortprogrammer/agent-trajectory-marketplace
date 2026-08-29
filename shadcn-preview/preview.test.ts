import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createPreviewHarness,
	type PreviewHarness,
} from "./preview-test-harness";

setDefaultTimeout(60_000);

let harness: PreviewHarness;

beforeAll(async () => {
	harness = await createPreviewHarness();
});

afterAll(async () => {
	await harness.close();
});

for (const viewport of [
	{ height: 900, width: 1280 },
	{ height: 1024, width: 768 },
	{ height: 812, width: 375 },
] as const) {
	test(`renders without horizontal overflow at ${viewport.width}px`, async () => {
		const { context, errors, page } = await harness.openPreview(viewport);

		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);

		expect(overflow).toBe(0);
		expect(errors).toEqual([]);
		await context.close();
	});
}

test("keeps every preview interaction local", async () => {
	const { context, errors, page, requests } = await harness.openPreview({
		height: 900,
		width: 1280,
	});

	await page.locator(".desktop-actions .button-variant-ghost").click();
	await page.locator("#access-email").fill("preview@example.com");
	await page
		.locator("form.dialog-form")
		.evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.locator(".dialog-success").waitFor({ state: "visible" });

	expect(requests.filter((url) => !url.startsWith(harness.previewUrl))).toEqual(
		[],
	);
	expect(errors).toEqual([]);
	await context.close();
});

test("requires buyer contact consent before local submission", async () => {
	const { context, errors, page, requests } = await harness.openPreview({
		height: 900,
		width: 1280,
	});
	await page.locator(".desktop-actions button").nth(1).click();
	const form = page.locator("form.dialog-form");

	await page.locator("#access-email").fill("preview@example.com");
	expect(
		await form.evaluate((element) =>
			(element as HTMLFormElement).checkValidity(),
		),
	).toBe(false);
	await page.locator(".checkbox-row input").check();
	expect(
		await form.evaluate((element) =>
			(element as HTMLFormElement).checkValidity(),
		),
	).toBe(true);
	const requestCount = requests.length;
	await form.evaluate((element) =>
		(element as HTMLFormElement).requestSubmit(),
	);
	await page.locator(".dialog-success").waitFor({ state: "visible" });

	expect(requests).toHaveLength(requestCount);
	expect(
		await page.evaluate(() => ({
			local: localStorage.length,
			session: sessionStorage.length,
		})),
	).toEqual({ local: 0, session: 0 });
	expect(errors).toEqual([]);
	await context.close();
});

test("shows the exact command for every process step", async () => {
	const { context, errors, page } = await harness.openPreview({
		height: 900,
		width: 1280,
	});
	const expectedCommands = [
		["Collect locally", "trajectory collect sessions codex"],
		[
			"Redact before upload",
			"trajectory marketplace seller candidate bundle --root /tmp/atm-sessions --print-selection",
		],
		[
			"Publish",
			"trajectory marketplace seller candidate publish --bundle /tmp/candidate.zip",
		],
	] as const;

	for (const [name, command] of expectedCommands) {
		await page.getByRole("tab", { name }).click();
		expect(await page.locator(".process-command code").innerText()).toBe(
			command,
		);
	}

	expect(errors).toEqual([]);
	await context.close();
});
