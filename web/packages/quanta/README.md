# @higgsfield/quanta

Higgsfield design tokens + React components. Source of truth for color,
typography, spacing, breakpoints, z-index, and border-width.
Framework-agnostic — works on top of Tailwind v4 or plain CSS.

## Quick start

```tsx
<div className="bg-q-background-primary text-q-text-primary p-4 rounded-lg">
  <h2 className="text-q-headline-md-semi-bold">Hello quanta</h2>
  <p className="text-q-body-md-regular text-q-text-secondary">World</p>
</div>
```

> **The `q-` namespace:** design-semantic utilities (color, typography, z-index,
> border-width, components) are prefixed with `q-` so they coexist with the
> legacy `@higgsfield/ui` system in one Tailwind build. Structural primitives
> (spacing, breakpoints) stay native, no prefix. Details: [`ai/AGENTS.md`](./ai/AGENTS.md).

## Package exports

| Path | Contents |
|---|---|
| `@higgsfield/quanta/tailwind.css` | `@theme` + `@utility` for Tailwind v4 |
| `@higgsfield/quanta/theme.css` | semantic aliases (color/typography by `data-theme`) |
| `@higgsfield/quanta/primitives.css` | raw literal values (`--hf-color-grey-900` etc.) |
| `@higgsfield/quanta/runtime` | `ThemeController`, `bootstrapScript`, `defineTheme`, `readInitialThemeState` |
| `@higgsfield/quanta/<component>` | React components — e.g. `/button`, `/dropdown` |

For large uniform asset feeds, use `VirtualGrid` from
`@higgsfield/quanta/grid`. Its optional `onEndReached` callback is deduplicated
per item count, so cursor pagination can stay infinite without mounting every
image or video.

Full token taxonomy, component APIs, and generation rules for AI agents live in
[`ai/AGENTS.md`](./ai/AGENTS.md). Token source: `src/css/tailwind/*.css`.

## License

Internal use only.
