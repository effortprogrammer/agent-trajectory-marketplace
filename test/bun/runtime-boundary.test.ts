import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "../..");

test("web UI and collector API bridge surfaces are absent", () => {
  // Given: the CLI-only repository root.
  const removedPaths = ["src/app", "src/components", "src/features", "src/lib", "e2e", "next.config.ts"];

  // When / Then: no removed web or bridge root remains.
  for (const path of removedPaths) expect(existsSync(resolve(projectRoot, path))).toBe(false);
});

describe("collector package boundary", () => {
  test("builds and runs every supported surface with Bun only", () => {
    // Given: the package manifest consumed by the CLI.
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8"));

    // When: its runtime scripts and engines are inspected.
    const scripts = manifest.scripts as Record<string, string>;
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;

    // Then: scripts and dependencies contain no web runtime.
    expect(manifest.packageManager).toMatch(/^bun@1\.3\./);
    expect(manifest.engines).toEqual({ bun: ">=1.3.0" });
    expect(scripts["build:collector"]).toContain("bun build");
    expect(scripts["build:collector"]).toContain("--target bun");
    expect(scripts.collector).toBe("bun dist/collector.js");
    expect(scripts.build).toBe("bun run build:collector");
    for (const dependency of ["next", "react", "react-dom", "@playwright/test", "vitest"]) {
      expect(dependencies[dependency]).toBeUndefined();
    }
  });
});
