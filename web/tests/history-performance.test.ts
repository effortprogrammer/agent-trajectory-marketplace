import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const hookSource = readFileSync(
  new URL("../src/components/gallery/use-justified-gallery.ts", import.meta.url),
  "utf8",
);
const tileSource = readFileSync(
  new URL("../src/components/gallery/gallery-tile.tsx", import.meta.url),
  "utf8",
);
const styleSource = readFileSync(
  new URL("../src/components/gallery/gallery.css", import.meta.url),
  "utf8",
);
const assetLibrarySource = readFileSync(
  new URL("../src/components/asset-library.tsx", import.meta.url),
  "utf8",
);

test("history windowing keeps scroll, paging, and media work bounded", () => {
  expect(hookSource).not.toContain("setScrollTop");
  expect(hookSource).toContain("lastAutoLoadKeyRef");
  expect(tileSource).toContain('preload="none"');
  expect(tileSource).not.toContain('preload="auto"');
  expect(tileSource).not.toContain("fastScroll");
  expect(styleSource).not.toContain("data-shimmer");
});

test("asset paging re-arms when a fetched page adds no selectable cards", () => {
  expect(assetLibrarySource).toContain("page?.loading !== true");
});
