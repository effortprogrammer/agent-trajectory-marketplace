# Instructions for AI agents using `@higgsfield/fnf-react`

Canonical AI guide for React apps that consume `@higgsfield/fnf-react`.
This package is the React integration layer over `@higgsfield/fnf`: TanStack
Query options for pull-shaped reads, external-store controllers for push-shaped
lifecycles (submit runs, uploads), stable SDK clients from one provider, and no
UI/product policy. All generation cache writes go through one door so job,
job-set, and feed entries stay consistent and terminal statuses never regress.

For model contracts, routes, settings, media validation, profile types, errors,
credits, and adapter behavior, read `../../fnf/ai/AGENTS.md` first. This guide
only explains the React integration layer. For generated UI, pair this package
with `@higgsfield/quanta` and read `../../quanta/ai/AGENTS.md`; `fnf-react`
does not provide components, styles, layout rules, or product copy.

## TL;DR rules

1. **Use both providers.** Host apps provide TanStack's `QueryClientProvider`;
   this package provides `FnfProvider`.
2. **Create SDK clients through `FnfProvider` in React code.** Use
   `createFnfReactClients()` only for tests or advanced non-provider hosts.
3. **Keep adapter, jobs, uploader, resolver, and observability references
   stable.** Controllers are stateful and bind to the first client/options they
   receive.
4. **Always use `scopeKey` for user/workspace caches.** Recommended shape:
   `${userId}:${workspaceId}`. Pass `{ scopeKey }` to query helpers and cache
   door helpers.
5. **Use query-option factories.** Use `generationQueryOptions`,
   `jobSetQueryOptions`, `jobsFeedQueryOptions`, character/reference/profile
   query options, and `costQueryOptions`. Never inline TanStack query-key
   arrays.
6. **Use the cache door for generation writes.** `applyGenerations`,
   `prependGenerations`, and `removeGenerationQueries` are the only supported
   generation cache mutation helpers.
7. **Resume live feed items.** Call `useLiveFeedGenerations` with the flattened
   feed so queued/in-progress jobs restored after a refresh keep polling.
8. **Use controllers for push lifecycles.** `useGenerationRun` handles submit
   to terminal state. `useAttachments` handles file upload and submit-ready
   refs.
9. **Errors are state, not UI policy.** `run.start()` does not reject; read
   `run.error`, `run.failed`, and generation statuses. This package does not
   show toasts, redirect, gate plans, or write product copy.
10. **Workspace switching is only SDK/backend context.** Host apps still update
   Clerk/session metadata, adapter header state, routing, and copy.
11. **Observability is safe metadata-only.** Never emit prompts, raw params,
   headers, tokens, URLs, filenames, emails, workspace names, or file bytes.
12. **Use Quanta for the actual interface.** Build forms, feeds, profile panels,
    drawers, command palettes, toasts, and status surfaces with Quanta
    components in host apps; keep this package headless.

## Provider setup

```tsx
import { createFnfWebAdapter } from '@higgsfield/fnf-adapters'
import { seedance2_0 } from '@higgsfield/fnf/jobs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  FnfProvider,
  useFnf,
  useFnfCharacterClient,
  useFnfJobClient,
  useFnfJobs,
  useFnfLlmClient,
  useFnfMediaClient,
  useFnfObservability,
  useFnfProfileClient,
  useFnfReferenceClient,
  useFnfScopeKey,
} from '@higgsfield/fnf-react'

const queryClient = new QueryClient()

function Root() {
  const adapter = useMemo(
    () => createFnfWebAdapter({
      baseUrl,
      getToken,
      workspaceId: activeWorkspaceId,
    }),
    [activeWorkspaceId, baseUrl, getToken],
  )
  const scopeKey = `${userId}:${activeWorkspaceId}`

  return (
    <QueryClientProvider client={queryClient}>
      <FnfProvider
        adapter={adapter}
        jobs={[seedance2_0]}
        scopeKey={scopeKey}
        observability={observability}
      >
        <App />
      </FnfProvider>
    </QueryClientProvider>
  )
}

function App() {
  const fnf = useFnf()
  const characters = useFnfCharacterClient()
  const jobs = useFnfJobClient()
  const media = useFnfMediaClient()
  const profile = useFnfProfileClient()
  const references = useFnfReferenceClient()
  const registry = useFnfJobs()
  const scopeKey = useFnfScopeKey()
  const observability = useFnfObservability()

  void fnf
  void characters
  void jobs
  void media
  void profile
  void references
  void registry
  void scopeKey
  void observability
}
```

`FnfProvider` accepts:

- `adapter`: required jobs backend. The fnf-web adapter also satisfies media
  and profile ports. UI hosts that submit generations must pass the adapter's
  `confirm` option — see "Submission confirmation gate" in
  `../../fnf/ai/AGENTS.md`.
- `jobs`: required SDK model registry. Model/settings autocomplete flows from
  this array.
- `mediaAdapter`, `profileAdapter`: optional overrides when jobs/media/profile
  use different ports.
- `characterAdapter`, `referenceAdapter`: optional overrides for
  custom-reference training and the user's Elements library.
- `blobUploader`, `resolveJob`: optional media-client dependencies.
- `llm`: optional browser-safe LLM chat backend. Read it with
  `useFnfLlmClient()` — the hook throws if no `llm` was provided. Generated
  apps keep the raw zero-token `createLlmClient` instance Worker-side on
  `https://fnf.internal/llm`, discover current ids there with `listModels()`,
  and proxy app-safe operations through authenticated server functions or
  routes. Never pass the raw client or a hardcoded catalog to browser code (see
  "LLM (chat completions)" in `../../fnf/ai/AGENTS.md`).
- `scopeKey`: optional cache isolation key; use it for user/workspace apps.
- `observability`: optional safe SDK observer config propagated into created
  job, media, profile clients and React controllers.

Use `createFnfReactClients(config)` for unit tests or non-provider hosts. Normal
components should read clients from provider hooks.

Important stability rule: do not create adapters or job arrays inline if that
causes a new reference every render. Keep them at module scope, in state, or in
memoized host infrastructure. Controllers intentionally bind to the first client
they receive.

## Browser/server boundary

`fnf-react` can run in browser React, but auth policy belongs to the host.

- Product apps may use a browser adapter only when the host intentionally
  provides a safe user-scoped token source.
- Generated app templates with server-only credentials should use browser
  adapters that call app-local `/api/*` routes, not direct fnf backend routes.
- Never expose dev user ids, bearer tokens, or privileged workspace headers to
  arbitrary visitors.

This package should not import environment variables or decide where secrets
live.

## Query options: pull side

Always use the exported query-option factories. They are the public contract for
polling, stale-time, key shapes, and scope behavior.

```tsx
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  characterQueryOptions,
  costQueryOptions,
  flattenFeedPages,
  generationQueryOptions,
  jobSetQueryOptions,
  jobsFeedQueryOptions,
  profileSnapshotQueryOptions,
  referenceQueryOptions,
  referencesQueryOptions,
  useLiveFeedGenerations,
} from '@higgsfield/fnf-react'

const scope = { scopeKey }

const generation = useQuery(generationQueryOptions(jobClient, jobId, scope))
const character = useQuery(characterQueryOptions(characterClient, characterId, scope))
const element = useQuery(referenceQueryOptions(referenceClient, elementId, scope))
const elements = useQuery(referencesQueryOptions(
  referenceClient,
  { category: 'character' },
  scope,
))
const jobSet = useQuery(jobSetQueryOptions(jobClient, jobSetId, scope))

const feed = useInfiniteQuery({
  ...jobsFeedQueryOptions(jobClient, { type: 'video', size: 20 }, scope),
  select: flattenFeedPages,
})
useLiveFeedGenerations(jobClient, feed.data ?? [], scope)

const snapshot = useQuery(profileSnapshotQueryOptions(profileClient, scope))
const cost = useQuery(costQueryOptions(jobClient, input, {
  ...scope,
  enabled: wirePreview.ok,
}))
```

Defaults:

- `generationQueryOptions` polls every `DEFAULT_POLL_INTERVAL_MS` while
  non-terminal, in background, and stops once terminal.
- `jobSetQueryOptions` polls one whole job set per tick and stops when every
  member is terminal.
- `jobsFeedQueryOptions` is door-driven with `staleTime: Infinity` by default.
  Use `invalidateQueries` for hard refreshes or spread your own `staleTime` if
  a host wants focus refetches.
- `flattenFeedPages` converts paginated feed data into a deduplicated list.
- `characterQueryOptions` polls character training until `completed` or
  `failed`; `referenceQueryOptions` polls processing Elements, while
  `referencesQueryOptions` lists the user's Elements library.

## Query keys and scope

Use `fnfKeys` factories only. Unscoped key shapes are backward-compatible public
contracts:

```ts
fnfKeys.job('g1')              // ['fnf', 'job', 'g1']
fnfKeys.jobSet('set1')         // ['fnf', 'job-set', 'set1']
fnfKeys.jobs({ type: 'video' }) // ['fnf', 'jobs', { type: 'video' }]
```

Scoped variants are additive:

```ts
const scope = { scopeKey: `${userId}:${workspaceId}` }

fnfKeys.job('g1', scope)
fnfKeys.jobSet('set1', scope)
fnfKeys.jobs({ type: 'video' }, scope)
fnfKeys.cost(input, scope)
fnfKeys.character('character1', scope)
fnfKeys.reference('element1', scope)
fnfKeys.references({ category: 'character' }, scope)
fnfKeys.profileSnapshot(scope)
fnfKeys.profileCredits({ ...scope, includeOnDemand: false })
```

Do not write `['fnf', ...]` arrays by hand in app code.

After character training completes, invalidate the matching
`fnfKeys.references(...)` query so the new Character Element appears. The
Element id and `reference.characterId` are distinct; pass `characterId` to
Soul generation as `settings.customReferenceId`.

## Cache door rules

Use these helpers for generation cache mutations:

```tsx
import {
  applyGenerations,
  prependGenerations,
  removeGenerationQueries,
} from '@higgsfield/fnf-react'

applyGenerations(queryClient, liveGenerations, { scopeKey })
prependGenerations(queryClient, { type: 'video', size: 20 }, submittedGenerations, { scopeKey })
removeGenerationQueries(queryClient, { scopeKey })
```

Rules:

- `applyGenerations` updates existing caches only. It folds fresh snapshots into
  job, job-set, and feed entries that already contain those ids.
- `prependGenerations` inserts fresh submit results into one explicit feed. The
  host chooses which feeds should show optimistic new work.
- `removeGenerationQueries` clears generation, job-set, feed, and cost caches
  for a scope without clearing profile caches.
- `foldGeneration` prevents stale non-terminal snapshots from reopening settled
  generations and preserves object references when nothing changed.
- Direct `queryClient.setQueryData(...)` for generation snapshots is an
  anti-pattern outside tested package helpers.

## Submit lifecycle controller

Use `useGenerationRun` in components and `GenerationRun` directly in tests or
framework adapters.

```tsx
import {
  prependGenerations,
  useGenerationRun,
} from '@higgsfield/fnf-react'

const run = useGenerationRun(jobClient, { scopeKey })

async function submit(input: Parameters<typeof jobClient.submit>[0]) {
  const generations = await run.start(input)
  prependGenerations(queryClient, { type: 'video', size: 20 }, generations, { scopeKey })
}
```

Lifecycle:

- `idle -> submitting -> generating -> completed | failed | aborted`
- `run.start(input)` resolves with settled generations and never rejects.
- `run.error` holds submit/poll run-level errors.
- `run.failed` and `run.warning` hold partial fan-out submit failures.
- Each generation's own `status` remains the per-job verdict surface.
- Starting a new run aborts the previous polling loop and late results are
  dropped.
- Unmounting the hook aborts polling. It does not cancel backend jobs; call the
  SDK job client's `cancel(id)` for server-side cancellation.
- Every controller commit folds `run.generations` through `applyGenerations`.
  It does not decide which feed should show fresh submits; call
  `prependGenerations` explicitly.

The job client passed to `useGenerationRun` must ultimately reach a server-side
SDK call. If a host wraps SDK calls in TanStack server functions or `/api/*`
routes, submit and cost must be `POST`, not `GET`. A 405 / "Method Not Allowed"
on generation is usually a route/function method mismatch below the React
controller, an old `operation`-envelope WFP adapter snapshot, or a backend route
contract mismatch. It is not a `useGenerationRun` state problem.

Do not send raw browser files through React Query variables or server-function
JSON inputs. For server-only fnf.internal hosts, upload files via multipart
`FormData` to an app-local `POST /api/media/upload` route and store only the
returned `MediaRef` in React state. `useGenerationRun` should receive
prompt/settings/refs, never `File`, `Blob`, `ArrayBuffer`, base64, or byte
arrays.

`useGenerationRun` receives provider observability by default. Pass
`observability` in hook options only when a specific run needs a different
observer.

## Attachments controller

Use `useAttachments` for file inputs. It uploads immediately, keeps previews,
and returns submit-ready refs.

```tsx
import { useAttachments } from '@higgsfield/fnf-react'

const attachments = useAttachments(mediaClient, {
  upload: { forceIpCheck: true },
})

function onFiles(files: File[]) {
  attachments.add(files, { role: 'start_image' })
}

async function submit() {
  const refs = await attachments.settled()
  await jobClient.submit({
    model: 'seedance_2_0',
    media: { start_image: refs },
    prompt,
    settings,
  })
}
```

Lifecycle:

- File items start as `uploading`, then become `ready`, `blocked`, or `failed`.
- Already-uploaded `MediaRef` values are added as `ready`.
- `blocked` is moderation-as-state; it is not thrown and does not appear in
  `attachments.refs`.
- `failed` items can be retried with `attachments.retry(key)`.
- `remove(key)` aborts an in-flight upload and revokes local preview URLs.
- `clear()` aborts all in-flight uploads and removes every item.
- `settled()` waits for in-flight uploads and returns ready refs.
- `move(from, to)` is presentational ordering.
- Intrinsic image/video/audio meta is measured by default from local files and
  attached to `MediaRef.meta`. Set `measure: false` to disable it. Measurement
  is best-effort by contract: a failed measurement never fails the upload.
- Use `useAttachments` only when its media client can upload in the browser
  safely. If the adapter/token must stay server-side, build a multipart upload
  route and feed the returned `MediaRef` into the same UI state shape.

The controller does not enforce job media counts, roles, dimensions, or
duration limits. The SDK job declaration validates those when building/submitting
the job.

## Profile and workspace

Use profile query options for account/workspace reads.

```tsx
import { useQuery } from '@tanstack/react-query'
import {
  profileCreditsQueryOptions,
  profileCurrentWorkspaceQueryOptions,
  profileSnapshotQueryOptions,
  profileUserQueryOptions,
  profileWalletQueryOptions,
  profileWorkspacesQueryOptions,
  setProfileSnapshot,
} from '@higgsfield/fnf-react'

const profile = useFnfProfileClient()
const scope = { scopeKey }

const snapshot = useQuery(profileSnapshotQueryOptions(profile, scope))
const user = useQuery(profileUserQueryOptions(profile, scope))
const workspaces = useQuery(profileWorkspacesQueryOptions(profile, scope))
const current = useQuery(profileCurrentWorkspaceQueryOptions(profile, scope))
const wallet = useQuery(profileWalletQueryOptions(profile, scope))
const credits = useQuery(profileCreditsQueryOptions(profile, {
  ...scope,
  includeOnDemand: true,
}))

setProfileSnapshot(queryClient, snapshot.data!, scope)
```

Workspace switching:

```tsx
import { useSwitchWorkspaceMutation } from '@higgsfield/fnf-react'

const switchWorkspace = useSwitchWorkspaceMutation({
  scopeKey,
  nextScopeKey: snapshot => `${snapshot.user?.id}:${snapshot.currentWorkspace?.id}`,
  onWorkspaceChanged: async snapshot => {
    setActiveWorkspaceId(snapshot.currentWorkspace?.id ?? '')
    await updateHostSession(snapshot)
  },
})

await switchWorkspace.mutateAsync({ workspaceId })
```

On success, the mutation helper:

- calls `profile.switchWorkspace({ workspaceId })`
- removes generation/cost caches for the old scope
- removes old scoped profile caches when the scope changes
- writes the returned snapshot into profile caches for the next scope
- calls `onWorkspaceChanged(snapshot)`

It does not update Clerk/session metadata, mutate adapter header state, reload
the page, redirect, or show copy. The host must do those things.

## Request preview and cost

Use local wire previews to show validation/build-wire state without submitting.

```tsx
import {
  costQueryOptions,
  getWirePreview,
  useFnfWirePreview,
} from '@higgsfield/fnf-react'

const preview = useFnfWirePreview(input)
const manual = getWirePreview(input, jobs)

const cost = useQuery(costQueryOptions(jobClient, input, {
  scopeKey,
  enabled: preview.ok,
}))

if (preview.ok) {
  preview.jobSetType
  preview.outputType
  preview.params
}
else {
  preview.error.code
}
```

`cost.data?.credits` is already a display-credit value from the core SDK.
Profile wallet raw balances are credit-cents, but profile credits returned by
the SDK profile domain are normalized for display.

## Observability

`FnfProvider` accepts the core SDK observability options and passes them into
created clients. `useGenerationRun` and `useAttachments` also inherit provider
observability unless hook options override it.

Safe React event names include:

- `fnf.react.generation_run.start`
- `fnf.react.generation_run.submitted`
- `fnf.react.generation_run.progress`
- `fnf.react.generation_run.completed`
- `fnf.react.generation_run.failed`
- `fnf.react.generation_run.aborted`
- `fnf.react.generation_run.reset`
- `fnf.react.attachments.add`
- `fnf.react.attachments.upload_start`
- `fnf.react.attachments.ready`
- `fnf.react.attachments.blocked`
- `fnf.react.attachments.failed`
- `fnf.react.attachments.retry`
- `fnf.react.attachments.remove`
- `fnf.react.attachments.clear`
- `fnf.react.attachments.settled`

Observers are metadata-only; see the observability privacy rule in
`../../fnf/ai/AGENTS.md`.

## Realtime helpers

`Realtime` and `RefCountPool` are low-level helpers for shared live channels.
They are transport-agnostic and optional.

- Subscribe by job set when a transport has a real-time channel.
- Reuse one connection per job set through ref counting; the pool keeps the
  connection open for `freeGraceMs` (default 1000 ms) after the last
  unsubscribe so quick re-subscribes reuse it.
- Let event callbacks invalidate `fnfKeys.jobSet(jobSetId, { scopeKey })`.
- If a transport returns `undefined` or throws, treat it as "no channel" and
  rely on polling query options.

## When in doubt

Read `../../fnf/ai/AGENTS.md` for SDK/domain behavior, use `src/index.ts` as
the public API list, and keep host policy in the host app, not in `fnf-react`.
