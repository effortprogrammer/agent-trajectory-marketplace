import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { BrowserContext, Page } from "playwright";
import {
	createPreviewHarness,
	type PreviewHarness,
	subscribeToAttribute,
	subscribeToFocus,
} from "./preview-test-harness";

setDefaultTimeout(60_000);

const installCommand =
	"curl -fsSL https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/latest/download/install-agent.sh | bash -s -- --dir atm";

type ClipboardFailure = "permission" | "unavailable";
type FailurePreview = Readonly<{
	context: BrowserContext;
	page: Page;
	pageErrors: string[];
}>;

let harness: PreviewHarness;

beforeAll(async () => {
	harness = await createPreviewHarness();
});

afterAll(async () => {
	await harness.close();
});

const openClipboardFailure = async (
	failure: ClipboardFailure,
): Promise<FailurePreview> => {
	const context = await harness.browser.newContext({
		reducedMotion: "reduce",
		viewport: { height: 900, width: 1280 },
	});
	const page = await context.newPage();
	if (failure === "permission") {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: () =>
						Promise.reject(new DOMException("Denied", "NotAllowedError")),
				},
			});
		});
	} else {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: undefined,
			});
		});
	}
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto(harness.previewUrl, { waitUntil: "domcontentloaded" });
	await page.locator("main").waitFor({ state: "visible" });
	return { context, page, pageErrors };
};

test("supports keyboard tab navigation and dialog focus return", async () => {
	const { context, errors, page } = await harness.openPreview({
		height: 900,
		width: 1280,
	});
	const firstTab = page.locator('[role="tab"]').nth(0);
	const secondTab = page.locator('[role="tab"]').nth(1);

	await firstTab.focus();
	const secondTabSelected = await subscribeToAttribute(
		secondTab,
		"aria-selected",
		"true",
	);
	await page.keyboard.press("ArrowRight");
	await secondTabSelected.wait;

	expect(await secondTab.getAttribute("aria-selected")).toBe("true");
	expect(await secondTab.getAttribute("aria-controls")).toBeTruthy();
	expect(await page.locator('[role="tabpanel"]').count()).toBe(1);

	const trigger = page.locator(".desktop-actions button").nth(1);
	await trigger.click();
	await page.locator(".dialog-content").waitFor({ state: "visible" });
	expect(await page.evaluate(() => document.activeElement?.id)).toBe(
		"access-email",
	);
	const dialogHidden = page
		.locator(".dialog-content")
		.waitFor({ state: "hidden" });
	const focusRestored = await subscribeToFocus(trigger);
	await page.keyboard.press("Escape");
	await Promise.all([dialogHidden, focusRestored.wait]);

	expect(
		await trigger.evaluate((element) => element === document.activeElement),
	).toBe(true);
	expect(errors).toEqual([]);
	await context.close();
});

test("copies the exact installer command", async () => {
	const { context, errors, page } = await harness.openPreview({
		height: 900,
		width: 1280,
	});
	await context.grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: harness.previewUrl,
	});

	const copyCompleted = await subscribeToAttribute(
		page.locator(".copy-status"),
		"data-copy-state",
		"success",
	);
	await page
		.locator('.command-card [aria-label="Copy install command"]')
		.click();
	await copyCompleted.wait;

	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		installCommand,
	);
	expect(errors).toEqual([]);
	await context.close();
});

test("closes the mobile menu with Escape", async () => {
	const { context, errors, page } = await harness.openPreview({
		height: 812,
		width: 375,
	});
	const toggle = page.locator(".menu-button");

	expect(await toggle.getAttribute("aria-controls")).toBe("mobile-navigation");
	await toggle.click();
	await page.locator("#mobile-navigation").waitFor({ state: "visible" });
	const menuHidden = page
		.locator("#mobile-navigation")
		.waitFor({ state: "hidden" });
	const focusRestored = await subscribeToFocus(toggle);
	await page.keyboard.press("Escape");
	await Promise.all([menuHidden, focusRestored.wait]);

	expect(await toggle.getAttribute("aria-expanded")).toBe("false");
	expect(
		await toggle.evaluate((element) => element === document.activeElement),
	).toBe(true);
	expect(errors).toEqual([]);
	await context.close();
});

test("returns focus to a mobile dialog trigger", async () => {
	const { context, errors, page } = await harness.openPreview({
		height: 812,
		width: 375,
	});
	await page.locator(".menu-button").click();
	const trigger = page.locator(".mobile-nav button").nth(1);

	await trigger.click();
	await page.locator(".dialog-content").waitFor({ state: "visible" });
	const dialogHidden = page
		.locator(".dialog-content")
		.waitFor({ state: "hidden" });
	const focusRestored = await subscribeToFocus(trigger);
	await page.keyboard.press("Escape");
	await Promise.all([dialogHidden, focusRestored.wait]);

	expect(
		await trigger.evaluate((element) => element === document.activeElement),
	).toBe(true);
	expect(errors).toEqual([]);
	await context.close();
});

for (const failure of ["permission", "unavailable"] as const) {
	test(`reports ${failure} clipboard failure without a page error`, async () => {
		const { context, page, pageErrors } = await openClipboardFailure(failure);
		const errorState = await subscribeToAttribute(
			page.locator(".copy-status"),
			"data-copy-state",
			"error",
		);

		await page
			.locator('.command-card [aria-label="Copy install command"]')
			.click();
		await errorState.wait;

		expect(await page.locator(".copy-status").getAttribute("aria-live")).toBe(
			"polite",
		);
		expect(pageErrors).toEqual([]);
		await context.close();
	});
}
