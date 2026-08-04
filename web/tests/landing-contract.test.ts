import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { landingContentSchema } from "@higgsfield/app-landing";
import { landingContent } from "../src/landing-content";

describe("scroll-scrub website landing contract", () => {
  test("uses a safe full-app route preview", () => {
    expect(() => landingContentSchema.parse(landingContent)).not.toThrow();
    expect(landingContent.preview).toMatchObject({
      kind: "route",
      src: "/app?preview=1",
      openHref: "/app",
    });
    expect(landingContent.steps.items).toHaveLength(3);
    expect(landingContent.steps.items.map((item) => item.preview.kind)).toEqual([
      "instruction",
      "action",
      "result",
    ]);
    expect(landingContent.features.items).toHaveLength(3);
  });

  test("keeps public landing and full app routes separate", () => {
    const landingRoute = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
    const appRoute = readFileSync(new URL("../src/routes/app.tsx", import.meta.url), "utf8");

    // scroll-scrub's home IS the site: "/" renders the journey instead of the
    // stock LandingPage. Everything else about the split is unchanged.
    expect(landingRoute).toContain("ScrollScrub");
    expect(appRoute).toContain('createFileRoute("/app")');
    expect(appRoute).toContain("previewMode");
  });

  test("ships the canonical generations workspace recipe", () => {
    const layout = readFileSync(new URL("../src/layouts/custom.tsx", import.meta.url), "utf8");

    expect(layout).toContain('id: "generations"');
    expect(layout).toContain('mode="generations"');
    expect(layout).toContain("<UserGenerations demo");
    expect(layout).toContain("<PromptBox.Root");
  });
});
