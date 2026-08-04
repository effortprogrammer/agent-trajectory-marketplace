# Custom layout — constrained fallback, not a blank canvas

Use this template only when `studio`, `preset`, and `app-detail` cannot express
the requested product without breaking their layout contracts. Custom does not
mean freeform: adapt `src/layouts/custom.tsx` in place and keep the shared shell
and recipes from `@/components/custom-ui`.

## Mandatory structure

0. `src/routes/index.tsx` owns the generated public landing; this layout is
   rendered full-screen by `src/routes/app.tsx`. Keep those responsibilities
   separate. `CustomTemplate` must continue accepting `previewMode` so the
   landing can show `/app?preview=1` without triggering product side effects.
1. `CustomAppShell` owns responsive navigation, page background, overflow, and
   the desktop/mobile shell. Its desktop navigation is the canonical Quanta
   `Sidebar` shared with Studio. It also owns Studio's subtle top dot-grid +
   radial-glow atmosphere; keep it anchored while content scrolls independently.
   Do not replace it with a hand-built app frame or route-local backdrop.
   Navigation may sit left or right via `navigationSide`, or be omitted. Each
   side may contain one structural rail: the navigation `Sidebar` or the
   preset-style `SettingsRail` passed through `leftRail` / `rightRail`. Never
   position side rails manually in route/layout markup. Every desktop-only
   settings rail needs a mobile Modal/Drawer or dedicated-view counterpart.
2. Every center view uses `WorkspaceContent`, but its inside is product-shaped:
   - `page`: `Page` → centered `PageHeader` → `Section` → `Panel`.
   - `canvas`: any focused domain workspace — 3D editor, node graph, timeline,
     map, code editor, media editor, or another custom interaction surface.
   - `generations`: canonical `UserGenerations` with the shared Studio
     `PromptBox` dock; cards retain their built-in generation detail opening.
     Never hand-build the grid.
   Do not force a 3D/editor/canvas product into dashboard cards or `Page`.
3. In `page` mode, `PageHeader` is the centered first-focus block with generous
   vertical padding. Repeated summary values use `MetricCard`; zero-data panels
   use `EmptyState`. These recipes are optional in `canvas`/`generations` modes.
4. Treat the shell as three visually distinct zones: left rail, center workspace,
   right rail. A rail may be empty and the center may expand, but boundaries,
   background, spacing, and ownership must remain clear.
5. Use one obvious primary action per page. Secondary controls must be quieter.
6. Default pages are focus-first: after `PageHeader`, show at most two primary
   sections before the user navigates or asks for more. Do not optimize for
   fitting everything above the fold; scrolling is healthier than compression.
7. Never duplicate a full feature on Overview when it already has a navigation
   destination. Overview shows a short summary and a `View all` path.
8. Move creation forms, advanced settings, filters, and destructive actions
   behind `Modal`, `Dropdown`, `Accordion`, or a dedicated view. Render them
   inline only when they are the page's single primary task.
9. A card, panel, toolbar group, settings section, or menu exposes at most 3–4
   primary children at once. More controls must be nested under Tabs, Accordion,
   Dropdown, Modal, a “More” action, or a dedicated sub-view. Split complicated
   elements instead of producing dense all-in-one surfaces.

## Visual contract

- Permanently dark; no theme toggle and no `dark:` classes.
- Quanta components and semantic `q-` color/type/radius/shadow tokens only.
- Normal Tailwind spacing/layout utilities are allowed.
- No raw hex/rgb/hsl colors, arbitrary color utilities, gradients, or bespoke
  shadows in app code.
- No third-party component library and no copied shadcn components.
- Lucide icons go through Quanta `Icon`. Sidebar gradient `IconTile` is the one
  exception: pass Phosphor glyphs and always render their real `weight="fill"`
  artwork. Never fake fill on a Lucide outline or use emoji as UI icons.
- Buttons default to `size="sm"`; dense navigation/toolbars use `xs`. Use `md`
  only for a deliberately prominent primary action in a spacious composition,
  never as the routine page/form default.
- Use Inter/title/body typography for product UI. Accent/display typography is
  reserved for a deliberate marketing moment, never routine headings.
- Motion is subtle, functional, and respects reduced motion.
- Preserve generous rhythm: `Page` owns large section gaps, `Section` owns
  heading-to-content spacing, and `Panel` owns internal padding. Do not tighten
  these globally to squeeze another feature onto the screen.

## Adaptation requirements

Everything shipped in `custom.tsx` is MOCK: brand, navigation, metrics, activity,
forms, labels, empty states, and actions. Replace all of it with the real app's
information architecture and working behavior. Delete recipes the app does not
need; do not leave showcase sections in the finished product.
Everything shipped in `src/landing-content.ts` and
`public/assets/landing/template-preview.svg` is also MOCK. Generate concise
product-specific copy from the same AppBrief. Keep the step previews as
instruction UI → primary action → result media, generate owned result/showcase
media under `public/assets/landing/`, then remove the template preview asset.
Every landing asset must be distinct from the app preview, marketplace cover,
and every other section asset.
Never render agent instructions, implementation reminders, adaptation warnings,
or phrases such as “replace mock content” inside the product UI.

Before finishing:

1. Run `bun run check:ui`.
2. Run `bun run check:adapted` and remove every mock marker it reports.
3. Run `bun run typecheck`.
4. Check desktop and mobile screenshots.
5. Verify empty, loading, error, disabled, and success states.
