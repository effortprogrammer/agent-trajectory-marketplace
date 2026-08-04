import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const activeUiFiles = [
  "src/layouts/custom.tsx",
  "src/components/custom-ui/custom-ui.tsx",
  "src/routes/index.tsx",
  "src/routes/app.tsx",
  "src/landing-content.ts",
];

const mockMarkers = [
  "Custom App",
  "Workspace overview",
  "Keep your workspace moving",
  "First workflow completed",
  "A concise view of current performance",
];

const failures = [];
const landingPath = join(root, "src/landing-content.ts");
if (!existsSync(landingPath)) {
  failures.push("src/landing-content.ts is required");
} else {
  const landingSource = readFileSync(landingPath, "utf8");
  for (const section of ["hero", "preview", "steps", "features", "showcase", "finalCta"]) {
    if (!new RegExp(`\\b${section}\\s*:`).test(landingSource)) {
      failures.push(`src/landing-content.ts is missing required ${section} content`);
    }
  }
  if (/TEMPLATE DEMO|template-preview/i.test(landingSource)) {
    failures.push("src/landing-content.ts still contains template landing content");
  }

  let landingContent;
  try {
    ({ landingContent } = await import(pathToFileURL(landingPath).href));
  } catch (error) {
    failures.push(
      `src/landing-content.ts could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (landingContent != null) {
    const media = [
      landingContent.preview.kind === "media" ? landingContent.preview.media : undefined,
      landingContent.steps.items[2]?.preview.media,
      ...landingContent.showcase.items.map((item) => item.media),
      landingContent.finalCta.backgroundMedia,
    ].filter(Boolean);
    const landingAssets = [];

    for (const item of media) {
      const asset = item.src;
      if (!asset.startsWith("/assets/landing/")) {
        failures.push(
          `src/landing-content.ts must use dedicated /assets/landing/ media: ${asset}`,
        );
        continue;
      }
      const assetPath = join(root, "public", asset.slice(1));
      if (!existsSync(assetPath)) {
        failures.push(`src/landing-content.ts references a missing asset: ${asset}`);
        continue;
      }
      landingAssets.push({ asset, path: assetPath });
    }

    if (landingAssets.length < 2) {
      failures.push(
        "src/landing-content.ts must include separate owned result and showcase media",
      );
    }

    const sourcePaths = new Set();
    const contentHashes = new Map();
    for (const { asset, path } of landingAssets) {
      if (sourcePaths.has(asset)) {
        failures.push(`src/landing-content.ts reuses landing media: ${asset}`);
      }
      sourcePaths.add(asset);

      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      const existing = contentHashes.get(hash);
      if (existing != null && existing !== asset) {
        failures.push(
          `src/landing-content.ts uses duplicate files for ${existing} and ${asset}`,
        );
      } else {
        contentHashes.set(hash, asset);
      }
    }
  }
}

const landingRoutePath = join(root, "src/routes/index.tsx");
if (
  !existsSync(landingRoutePath) ||
  !readFileSync(landingRoutePath, "utf8").includes("LandingPage")
) {
  failures.push("src/routes/index.tsx must render the public LandingPage");
}

const appRoutePath = join(root, "src/routes/app.tsx");
if (!existsSync(appRoutePath) || !readFileSync(appRoutePath, "utf8").includes("previewMode")) {
  failures.push("src/routes/app.tsx must expose the full app and previewMode");
}

for (const relativePath of activeUiFiles) {
  const path = join(root, relativePath);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  for (const marker of mockMarkers) {
    if (source.includes(marker)) failures.push(`${relativePath} still contains mock copy: ${marker}`);
  }
  if (/\/presets\/|unsplash\.com|picsum\.photos|placehold\.co/.test(source)) {
    failures.push(`${relativePath} still references placeholder media`);
  }
}

const meta = JSON.parse(readFileSync(join(root, "src/app-meta.json"), "utf8"));
for (const field of ["og_title", "og_description", "favicon_url", "marketplace_cover_url"]) {
  if (typeof meta[field] !== "string" || meta[field].trim() === "") {
    failures.push(`src/app-meta.json must define ${field}`);
  }
}

if (failures.length > 0) {
  console.error("Custom template is not fully adapted:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Custom template adaptation check passed.");
