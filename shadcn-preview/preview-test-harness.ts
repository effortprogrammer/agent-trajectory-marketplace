import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { chromium } from "playwright";
import { createPreviewFetch } from "./preview-server";

const previewRoot = new URL(".", import.meta.url).pathname;

type Viewport = Readonly<{ height: number; width: number }>;
type PreviewPage = Readonly<{
	context: BrowserContext;
	errors: string[];
	page: Page;
	requests: string[];
}>;

type PreviewHarness = Readonly<{
	browser: Browser;
	close: () => Promise<void>;
	openPreview: (viewport: Viewport) => Promise<PreviewPage>;
	previewUrl: string;
}>;

type DomSubscription = Readonly<{ wait: Promise<void> }>;

let signalSequence = 0;

const subscribeToAttribute = async (
	locator: Locator,
	attribute: string,
	expected: string,
): Promise<DomSubscription> => {
	const token = `preview-attribute-${signalSequence++}`;
	const page = locator.page();
	const wait = page
		.waitForEvent("console", {
			predicate: (message) =>
				message.type() === "debug" && message.text() === token,
			timeout: 2_000,
		})
		.then(() => undefined);
	await locator.evaluate(
		(element, options) => {
			const notify = () => console.debug(options.token);
			if (element.getAttribute(options.attribute) === options.expected) {
				queueMicrotask(notify);
				return;
			}
			const observer = new MutationObserver(() => {
				if (element.getAttribute(options.attribute) !== options.expected)
					return;
				observer.disconnect();
				notify();
			});
			observer.observe(element, {
				attributeFilter: [options.attribute],
				attributes: true,
			});
			window.setTimeout(() => {
				if (element.getAttribute(options.attribute) !== options.expected)
					observer.disconnect();
			}, options.timeoutMs);
		},
		{ attribute, expected, timeoutMs: 2_000, token },
	);
	return { wait };
};

const subscribeToFocus = async (locator: Locator): Promise<DomSubscription> => {
	const token = `preview-focus-${signalSequence++}`;
	const page = locator.page();
	const wait = page
		.waitForEvent("console", {
			predicate: (message) =>
				message.type() === "debug" && message.text() === token,
			timeout: 2_000,
		})
		.then(() => undefined);
	await locator.evaluate(
		(element, options) => {
			const notify = () => console.debug(options.token);
			if (element === document.activeElement) {
				queueMicrotask(notify);
				return;
			}
			const onFocus = () => {
				if (element !== document.activeElement) return;
				document.removeEventListener("focusin", onFocus);
				notify();
			};
			document.addEventListener("focusin", onFocus);
			window.setTimeout(() => {
				if (element !== document.activeElement)
					document.removeEventListener("focusin", onFocus);
			}, options.timeoutMs);
		},
		{ timeoutMs: 2_000, token },
	);
	return { wait };
};

const createPreviewHarness = async (): Promise<PreviewHarness> => {
	const server = Bun.serve({
		port: 0,
		fetch: createPreviewFetch(previewRoot),
	});
	const previewUrl = `http://localhost:${server.port}`;
	const browser = await chromium.launch({ headless: true });
	const openPreview = async (viewport: Viewport): Promise<PreviewPage> => {
		const context = await browser.newContext({
			reducedMotion: "reduce",
			viewport,
		});
		const page = await context.newPage();
		const errors: string[] = [];
		const requests: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(`console:${message.text()}`);
		});
		page.on("pageerror", (error) => errors.push(`page:${error.message}`));
		page.on("request", (request) => requests.push(request.url()));
		await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
		await page.locator("main").waitFor({ state: "visible" });
		return { context, errors, page, requests };
	};
	return {
		browser,
		close: async () => {
			await browser.close();
			server.stop(true);
		},
		openPreview,
		previewUrl,
	};
};

export {
	createPreviewHarness,
	type PreviewHarness,
	subscribeToAttribute,
	subscribeToFocus,
};
