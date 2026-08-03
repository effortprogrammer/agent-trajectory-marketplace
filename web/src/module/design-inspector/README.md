# Design inspector module

Template-local child runtime for Supercomputer Design mode.

This module is not an SDK package. The Supercomputer editor owns the parent iframe UI and
postMessage validation; this template module owns what runs inside the generated
app iframe during editable preview builds.

## Files

- `registry.ts` — WeakMap source metadata registry and React ref helpers used by
  compile-time instrumentation.
- `runtime.ts` — browser runtime installed by the app root only when
  `__HF_DESIGN_INSPECTOR__` is true.
- `vite.ts` — Vite/React-Babel helpers that inject design-only callback refs into
  intrinsic JSX DOM tags and ref-capable component usages.

## Rules

- Never manually add `data-hf-*` attributes or source metadata in app code.
- Metadata lives in `WeakMap<Element, SourceMeta>`, not in DOM markup.
- The design build instruments intrinsic tags plus PascalCase/member component
  usages such as `Sparkles`, `Icon.Edit`, or `NavigationMenu.Item`. This gives
  small icon components and wrapper components their own use-site metadata when
  they forward refs to a DOM element.
- Components that swallow refs cannot expose use-site metadata. In that case,
  the runtime falls back to the nearest instrumented DOM child/ancestor or
  heuristic metadata.
- `bun run build` is production-clean by default: no inspector runtime and no
  metadata. Setting `HF_DESIGN_INSPECTOR=1` in the env turns the same build into
  the editable Supercomputer preview build — this is what deploys ship (apps-ci
  / apps-ci-dev export the flag before `bun run build`). `bun run dev:design`
  is the local inspector-on dev server.
- The only DOM mutation allowed while active is global selector state such as
  `body[data-selector-active="true"]`.
- While active, the runtime injects a temporary global cursor style so the
  iframe document uses `cursor: crosshair`; remove it when Design mode is off.
- Hover messages must include live `pointer: { x, y }` viewport coordinates and
  should be sent through `requestAnimationFrame`, even when the hovered element
  did not change. The parent tooltip follows this pointer.
- During scroll, emit `HF_DESIGN_SCROLL` with the live viewport scroll offsets.
  The parent hides transient hover chrome, keeps selected overlays visible by
  applying the scroll delta, then recomputes the hovered element at the last
  pointer position after scroll stops.
- Escape must exit Design mode. The runtime should disable local selector state
  immediately and post `HF_DESIGN_EXIT` so the parent toolbar turns off too.
- Do not log or post cookies, tokens, auth headers, storage values, input values,
  raw HTML, uploaded bytes, or raw media URLs.
