# Canonical Higgsfield packages

This directory is the source of truth for the local workspaces composed into
every scaffold. Make shared SDK, React binding, and Quanta fixes here; never
patch a generated template's ignored `app/packages` snapshot directly.

- `@higgsfield/fnf` — SDK core: jobs, media, profile, observability, adapters.
- `@higgsfield/fnf-react` — React provider, TanStack Query options, cache door,
  controllers.
- `@higgsfield/quanta` — Higgsfield design tokens, CSS entries, and React
  components.
- `@higgsfield/app-landing` — typed generated-content schema and shared
  Quanta-based landing blocks for simple and custom apps.

After changing canonical packages, refresh each template's ignored workspace
snapshot from the repository root:

```bash
node cli/src/index.js sync
```

Then run the relevant package tests/typechecks through an installed template
workspace. The CLI performs the same composition when it scaffolds a new app.

Before using or editing a vendored package, read its guide:

- `packages/fnf/ai/AGENTS.md`
- `packages/fnf-react/ai/AGENTS.md`
- `packages/quanta/ai/AGENTS.md`

Template-owned infrastructure lives under `app/src/module/**`. The
Supercomputer Design mode child bridge is `app/src/module/design-inspector`.
