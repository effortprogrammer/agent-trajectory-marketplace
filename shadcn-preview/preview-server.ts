type PreviewAsset = Readonly<{
	file: string;
	transpile?: boolean;
	type: string;
}>;

export const previewAssets = {
	"/": { file: "index.html", type: "text/html; charset=utf-8" },
	"/app.js": {
		file: "app.ts",
		transpile: true,
		type: "text/javascript; charset=utf-8",
	},
	"/content.js": {
		file: "content.ts",
		transpile: true,
		type: "text/javascript; charset=utf-8",
	},
	"/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
	"/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
	"/styles/conversion.css": {
		file: "styles/conversion.css",
		type: "text/css; charset=utf-8",
	},
	"/styles/dialog.css": {
		file: "styles/dialog.css",
		type: "text/css; charset=utf-8",
	},
	"/styles/foundation.css": {
		file: "styles/foundation.css",
		type: "text/css; charset=utf-8",
	},
	"/styles/landing.css": {
		file: "styles/landing.css",
		type: "text/css; charset=utf-8",
	},
	"/styles/responsive.css": {
		file: "styles/responsive.css",
		type: "text/css; charset=utf-8",
	},
	"/styles/supply-process.css": {
		file: "styles/supply-process.css",
		type: "text/css; charset=utf-8",
	},
} as const satisfies Readonly<Record<string, PreviewAsset>>;

const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });

type PreviewFetch = (request: Request) => Response | Promise<Response>;

export const createPreviewFetch =
	(root: string): PreviewFetch =>
	async (request: Request): Promise<Response> => {
		const pathname = new URL(request.url).pathname;
		if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
		const asset: PreviewAsset | undefined =
			previewAssets[pathname as keyof typeof previewAssets];
		if (asset === undefined) return new Response("Not found", { status: 404 });
		const file = Bun.file(`${root}/${asset.file}`);
		const body =
			asset.transpile === true
				? transpiler.transformSync(await file.text())
				: file;
		return new Response(body, { headers: { "content-type": asset.type } });
	};
