# @higgsfield/fnf-react

React bindings for `@higgsfield/fnf` — the layer that makes building a new
Higgsfield-style frontend fast, without leaking the SDK's internals or
inventing restrictions the SDK doesn't have.

The split is by shape: pull-shaped reads (feeds, job sets, single
generations) go through TanStack Query via `queryOptions` factories and a
cache door — you bring the `QueryClient`. Push-driven processes (submit runs,
upload lists) are framework-agnostic `ExternalStore` controllers with thin
`useSyncExternalStore` hooks. Clients come from one provider (`FnfProvider`);
the package has no auth, billing, routing, copy, or UI opinions.

An optional LLM backend may be provided to `FnfProvider` and read with
`useFnfLlmClient()`. In generated apps, it must be a browser-safe proxy: keep
the raw `createLlmClient` instance Worker-side, discover current model ids
there with `listModels()`, and expose app-safe operations through authenticated
server functions or routes. Never bundle the raw client or a hardcoded catalog.

## The cache door

TanStack is a non-normalizing document cache — one generation lives as
copies under many keys. The door makes that safe: every write goes through
`foldGeneration` (terminal anti-regress — a stale read can never roll back a
settled generation; reference stability — an unchanged snapshot keeps the
previous object, so memoized tiles don't re-render). The door **updates, it
never seeds**: unknown ids are ignored, membership belongs to fetches and
`prependGenerations`. Which feeds should show a fresh submit is product
policy — the fan-out stays your explicit call.

Feed queries are intentionally stable after loading. Mount
`useLiveFeedGenerations(client, flattenedFeed, { scopeKey })` beside a visible
feed so non-terminal jobs restored after refresh keep polling; the hook writes
fresh snapshots through the same cache door and stops observing terminal jobs.

## What this package deliberately is NOT

- Not a second cache — TanStack owns caching; the package owns the domain
  rules of writing into it.
- Not a UI kit and not product policy — no toasts, no plan gates, no copy.
- Not a second SDK — everything it exposes is the SDK's own domain model
  (`Generation`, `MediaRef`, `ApiJobError`).

All rules, code idioms, and API usage live in `ai/AGENTS.md`.
