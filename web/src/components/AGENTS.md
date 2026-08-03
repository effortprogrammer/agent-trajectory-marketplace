# Custom UI recipes

`@/components/custom-ui` is the required composition layer for this template.
Extend these recipes backward-compatibly instead of creating route-local visual
systems. Only `CustomAppShell` + `WorkspaceContent` are universal; page recipes
are optional when the center is a custom canvas or generations feed.

| Recipe | Purpose |
| --- | --- |
| `CustomAppShell` | Responsive desktop sidebar + compact mobile navigation |
| `SettingsRail` | Preset-style scrollable input/settings rail for either shell side |
| `WorkspaceContent` | Central window mode: scrolling `page`, fixed `canvas`, or canonical `generations` feed |
| `Page` | Width, responsive padding, and vertical page rhythm |
| `PageHeader` | Eyebrow/title/description/action hierarchy |
| `Section` | Section heading, helper copy, and optional trailing action |
| `Panel` | Canonical bordered raised surface |
| `VolumetricIconTile` | Canonical raised `sm/md/lg` icon box based on Figma Left_lg |
| `MetricCard` | Exactly two text levels: one large value + one short label; optional third fact becomes a compact top-right badge |
| `EmptyState` | Canonical zero-data state with one optional action |

## Rules for additions

- First compose Quanta primitives inside an existing recipe.
- Add a new shared recipe only after the pattern appears at least twice.
- Keep state and business logic in features/routes; recipes own presentation.
- Every interactive control needs keyboard behavior, focus visibility, labels,
  disabled state, and error/busy feedback where relevant.
- Keep every panel/card/toolbar/settings group to 3–4 primary children. Use
  progressive disclosure or split the group when more functionality exists.
- Do not create generic `Card`, `Container`, or `Box` wrappers that duplicate
  `Panel`, `Page`, or `Section`.
- Every neutral raised icon box uses `VolumetricIconTile`. Never recreate its
  single-surface border, gradient, radius, or shadow inline.
- Metric cards never stack three text rows. Keep only value + label; represent
  a brief delta/status with `badge`, or move longer context outside the card.
- Sidebar navigation always uses the shared `IconTile` with a Phosphor glyph;
  gradient tiles render `weight="fill"` and must never receive Lucide outlines.
- Every shell view wraps its center in `WorkspaceContent`. `generations` mode
  renders canonical `UserGenerations` with the shared Studio `PromptBox` dock;
  cards keep their built-in click-to-open `GenerationDetailModal`. Never
  hand-build a feed grid or import private `@/components/gallery` internals.
  Live feeds pass real `items`, `hasMore`, `loadingMore`, and a stable
  `onLoadMore`; seeded history requires explicit `demo`. Never auto-page a
  client-filtered subset of a global cursor.
- Do not copy components from the other templates unless the product genuinely
  needs that complete interaction contract.

## shadcn UI kit (`@/components/ui`)

`src/components/ui` is a complete shadcn v4 kit skinned with Quanta's
`--hf-*` tokens and pixel-matched to the Higgsfield Components Figma
(button, marketing-button, close-button, checkbox, switch, tabs/segmented
control, badge, toast, dialog, text field/area). It coexists with Quanta;
both resolve to the same tokens, so mixing them in one screen is safe.

Division of labor:

- Shell and canonical surfaces stay on the recipes above (`CustomAppShell`,
  `WorkspaceContent`, `Panel`, `MetricCard`, …) and Quanta primitives.
- Reach for `@/components/ui` for interaction primitives the recipes do not
  cover: dialog/sheet/drawer, dropdown/context/menubar, command palette,
  combobox, calendar, charts, OTP input, resizable panes, sidebar, toasts.
- Toasts: mount `<Toaster />` from `@/components/ui/sonner` once at the root,
  then `import { toast } from "sonner"`.
- Buttons: `Button` is the app button; `MarketingButton` /
  `MarketingButtonSpecial` are the glossy landing CTAs. Both take `loading`.
- `check:ui` rules still apply to app code that composes the kit: no raw
  colors, no arbitrary color classes, no `dark:`. Kit internals are exempt;
  do not restyle kit components inline — pass semantic classes or extend the
  kit itself.
- Add more components with `bunx shadcn add <name>` (`components.json` is
  configured); new ones inherit the theme through the shadcn alias variables
  in `src/styles.css`.
