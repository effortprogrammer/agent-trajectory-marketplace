# Scroll-scrub website

A **`type: "website"`** template — a standalone brand, NOT a Higgsfield app.
The visitor's scroll plays a generated film while semantic chapters read over
it. The scrub engine is already built; your job is the film, the scenes, and
the brand.

The authoritative workflow is the `website-builder-flow` skill
(`references/scroll-scrub.md`). This file is the in-repo contract.

## The engine is done — do not rewrite it

`src/components/scroll-scrub/scroll-scrub.tsx` + `.css` ship the full runtime:
Blob-backed seeking, seek coalescing, lazy nearby-segment loading, desktop and
mobile sources, exact-frame posters held until a real painted frame, iOS
gesture priming, `prefers-reduced-motion`, reverse scroll, and complete
teardown (aborts, listeners, RAF, revoked Blob URLs).

Do NOT rebuild the controller, drive per-frame values through React state, or
attach a second scroll timeline to the same video elements. Adapt composition
and scene data instead. The engine intentionally ships **no** header, no shared
button system, no scroll hint, and no per-scene eyebrow — compose the site's
own nav and bespoke CTAs around it.

## What you fill in

| File | What you do |
|---|---|
| `src/scroll-scrub-scenes.ts` | Brand tokens + the scene array. Every `<...>` placeholder gets real copy. |
| `src/routes/index.tsx` | Compose the page: nav, chapters, CTAs, and the content sections after the journey. |
| `public/assets/world/` | The encoded clips and their exact-frame posters. |
| `src/styles.css` | The site's own token layer from the design brief. |
| `src/app-meta.json` | `og_title`, `og_description`, `favicon_url`, `og_image_url`, `marketplace_cover_url`. |

## Hard rules

- **This is a website, not an app.** Never import `@higgsfield/quanta/*`, never
  use q-prefixed tokens, never add "Sign in with Higgsfield", the fnf SDK, or
  any runtime generation. No "Powered by Higgsfield" anywhere in page content.
  The user's brand is the only brand on the page.
- **Every `poster` is the exact first frame of the clip beside it.** Never a
  design board, never an imagined destination still, never the next scene's
  image. Generate posters from the ENCODED clip, after encoding.
- **Provide `mobilePoster` whenever `mobileClip` is set.**
- **Keep `scrollScrubScenes` a module constant.** Changing its identity on
  every render rebuilds the controller.
- **CSP:** the controller assigns Blob URLs to `<video src>`, so `media-src`
  must include `blob:` and clip fetches stay same-origin (`connect-src 'self'`).
- **Byte budget:** start at ≤32 MiB for all desktop clips and ≤16 MiB for all
  mobile clips. Visited clips are retained for smooth reverse scroll, so
  oversized clips cost memory as well as transfer.
- **SSR safety:** no browser global at module top level or during render. A
  top-level `window` reference crashes SSR.
- **No placeholders may ship.** Every `<...>` token is replaced before deploy.

## Vendored packages and legacy scaffold files

`app/packages/` holds managed snapshots vendored from the Higgsfield web app
(`@higgsfield/fnf`, `fnf-react`, `quanta`, `app-landing`). Websites never use
them, but do NOT edit or delete them, and leave the Quanta Tailwind entry wired
in `src/styles.css` — the build depends on it.

**This template is a byte-for-byte copy of the `custom` app scaffold**, plus the
three scroll-scrub files and a `/` that renders the journey. Keeping it in
lockstep with `custom` is deliberate: the platform's build, deploy and design
inspector all assume that tree, and every past divergence has been a bug.

So it also carries the whole Higgsfield **app** surface — `src/layouts/`, the
`/app` route, `src/landing-content.ts`, the fnf/Quanta components (composer,
generation-card, gallery, asset-library, user-generations), the shadcn kit, and
demo assets under `public/presets/`. For a website these are inert raw material,
NOT part of the product:

- Do NOT wire them into the site, and do NOT import from `@higgsfield/quanta/*`
  or the fnf SDK by way of them.
- Delete NOTHING. Unused files simply stay unreferenced. Removing them is what
  makes this template drift from `custom`.
- The shadcn primitives in `@/components/ui` may be restyled to the design brief
  as ordinary React components when genuinely useful.

## Required completion checks

```bash
cd app
bun run typecheck
bun run build   # runs check:ui first, same as every app template
```

`check:ui` scans `src/layouts`, `src/routes`, `src/components/custom-ui`,
`src/features` and `src/widgets` for raw colour literals and `dark:` variants.
It does NOT scan `src/components/scroll-scrub` or `src/scroll-scrub-scenes.ts`,
so the site's own palette lives in those (and in `src/styles.css`) without
tripping the gate. Keep raw hex out of route files.
