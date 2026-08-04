#!/usr/bin/env node
// Postinstall guard: bun occasionally PARTIALLY extracts a large package —
// thousands of files land but a few are silently missing — and the failure
// shows up far from the cause: with zod, `vite build` crashes at config load
// (ERR_MODULE_NOT_FOUND on a locale file) and tsc reports phantom errors
// inside zod/mini typings. Verify sentinel files per known-flaky package,
// self-heal by re-extracting, and fail fast with the fix.
import { existsSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PACKAGES = [
  {
    name: "zod",
    files: [
      "index.js",
      "index.d.ts",
      "v4/classic/index.js",
      "v4/core/index.js",
      "v4/core/index.d.ts",
      "v4/mini/index.js",
      "v4/mini/index.d.ts",
      "v4/locales/uk.js",
    ],
  },
];

const corrupt = [];
for (const { name, files } of PACKAGES) {
  const dir = join(ROOT, "node_modules", ...name.split("/"));
  // Nothing to verify if the package isn't materialized (e.g. partial installs).
  if (!existsSync(dir)) continue;
  const missing = files.filter((rel) => !existsSync(join(dir, rel)));
  if (missing.length > 0) corrupt.push({ name, dir, missing });
}

if (corrupt.length > 0) {
  // Self-heal once: drop the corrupt extractions and let bun re-materialize
  // them. HF_INSTALL_HEAL guards recursion (the inner install re-runs this
  // postinstall).
  if (!process.env.HF_INSTALL_HEAL) {
    for (const { name, dir, missing } of corrupt) {
      console.warn(
        `${name} is PARTIALLY extracted — missing ${missing.length} file(s) ` +
          `(${missing.slice(0, 5).join(", ")}). Re-extracting…`,
      );
      // dir may be a symlink into bun's isolated store (node_modules/.bun/…) —
      // remove the REAL store dir too, or bun just re-links the corrupt copy.
      const real = realpathSync(dir);
      rmSync(real, { recursive: true, force: true });
      if (real !== dir) rmSync(dir, { recursive: true, force: true });
    }
    const r = spawnSync("bun", ["install", "--frozen-lockfile"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, HF_INSTALL_HEAL: "1" },
    });
    process.exit(r.status ?? 1);
  }
  for (const { name, missing } of corrupt) {
    console.error(
      `${name} is STILL partially extracted after a re-extract — ` +
        `missing: ${missing.slice(0, 10).join(", ")}\n` +
        `Fix manually: rm -rf node_modules/${name} && bun install`,
    );
  }
  process.exit(1);
}
