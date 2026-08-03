# Instructions for AI agents using `@higgsfield/fnf`

Canonical AI guide for code that consumes or extends the fnf SDK; This file is
the package-level source of truth for agents; `packages/fnf/CLAUDE.md` points
here. The README explains the full SDK shape, while this guide is the strict
operational contract: what to import, what to avoid, how to wire jobs/media/
profile/observability, and how to keep model parity correct.

For SDK implementation details, read `README.md`, source JSDoc, and tests. The
tests are the executable spec.

## TL;DR rules


1. **Use public subpath imports only**: `@higgsfield/fnf/client`, `/jobs`,
   `/media`, `/profile`, `/characters`, `/references`,
   `/observability`, `/workflow-platform`, `/errors`.
   Never deep-import `src/` paths. `@higgsfield/fnf` ships the backend
   ports/interfaces plus exactly ONE bundled adapter — the Workflow Platform
   adapter at `@higgsfield/fnf/workflow-platform` (so fnf-only hosts are
   self-sufficient for generated apps). Every other concrete adapter (fnf-web,
   dev, apps-marketplace, memory) lives in the separate
   `@higgsfield/fnf-adapters` package.
2. **Never hand-build backend wire params or routes.** `createJobClient`,
   `createMediaClient`, and `createProfileClient` own validation, codecs,
   snake_case mapping, derived fields, route quirks, polling, and typed errors.
3. **All normal SDK configuration is constructor input.** Do not add hidden
   `process.env` reads, hardcoded tokens, user ids, or base URLs in job/media/
   profile code. The one intentional exception is the server-only
   `createAppsMarketplaceAdapter` secret fallback (`FNF_APPS_MARKETPLACE_SECRET`
   by default), because that adapter is a trusted-service integration.
4. **Settings are public camelCase.** Jobs map backend names with `z.wire`, for
   example `batchSize -> batch_size`, `aspectRatio -> aspect_ratio`. Unknown
   settings are stripped by schema parsing; deliberate raw wire fields belong
   in `extra`.
5. **`count` and `batchSize` are different.** `count` is SDK fan-out into N
   separate submit calls. `batchSize` is a model setting sent inside one job.
   Total outputs are `count * batchSize`. Because host confirmation tokens are
   single-use, adapters with a `confirm` gate reject `count > 1`; use a model's
   `batchSize` setting for multiple outputs from one confirmed request.
6. **Upload media before submit.** `media.upload(...)` returns a `MediaRef`;
   pass it to `client.submit({ media: { role: ref } })`. Seedance media uploads
   that need IP checks must set `forceIpCheck: true`.
7. **Job submission requires a host confirmation gate.** Every generation
   adapter factory accepts a `confirm` option (`ConfirmSubmit`); if the host
   submits generations on behalf of a user, you must implement it. Embedded
   apps delegate the exact `jobSetType` + wire `params` to the platform's
   injected approval API and must not add a second dialog. Standalone UI hosts
   own their approval modal. `submit` calls the gate once per submission after
   validation, before any network call. Resolve to proceed — a resolved string
   token rides the submit body as `confirmation_token` — reject/throw to abort
   with the typed
   `confirmation_rejected` error. Only tests and non-interactive service flows
   may omit it. See "Submission confirmation gate" below.
8. **Attach or resolve `MediaRef.meta` when local validation depends on size or
   duration.** Unknown meta is skipped locally and remains backend-authoritative.
   `aspectRatio: 'auto'` uses first-image meta where model logic supports it.
9. **Display credits are divided by 100.** Wallet fields from `getWallet()` are
   backend credit-cents. `profile.getCredits()`, `profile.getSnapshot().credits`,
   and `client.cost(input).credits` are display credits.
10. **Use safe APIs across iframe/worker boundaries.** Prefer `safeSubmit` and
    `safeUploadMedia`; branch on `error.code`. `instanceof` is not reliable after
    JSON/postMessage/Comlink serialization.
11. **Observability is metadata-only.** Observers may receive model ids, status,
    durations, counts, and safe backend ids. Never emit prompts, auth headers,
    tokens, request/response bodies, upload URLs, result URLs, filenames, emails,
    workspace names, or file bytes. The submit confirmation token is a token —
    it never goes into observer attributes.

## Public entry points

```ts
import { createJobClient } from '@higgsfield/fnf/client'
import { createCharacterClient } from '@higgsfield/fnf/characters'
import { nanoBanana2, seedance2_0 } from '@higgsfield/fnf/jobs'
import { createMediaClient } from '@higgsfield/fnf/media'
import { createProfileClient } from '@higgsfield/fnf/profile'
import { createReferenceClient } from '@higgsfield/fnf/references'
import { createConsoleObserver } from '@higgsfield/fnf/observability'
import { createWorkflowPlatformAdapter } from '@higgsfield/fnf/workflow-platform'
import { createAppsMarketplaceAdapter, createDevFnfWebAdapter, createFnfWebAdapter } from '@higgsfield/fnf-adapters'
import { errorFromJSON } from '@higgsfield/fnf/errors'
```

The root barrel also exports these APIs, but subpaths are preferred because
agents and app bundlers can pull only the domain they need.

## Adapters and auth

One full adapter can satisfy jobs, media, and profile plus the optional
Elements and character-training ports. Reuse the same adapter when a host wants
a single auth/workspace context.

Scope rule: the `https://fnf.internal` requirement is a Supercomputer generated
app/template policy, not a universal SDK limitation. If the task explicitly
targets another approved web app, product surface, dev sandbox, service
integration, or custom endpoint, choose or implement the adapter for that host's
backend contract. Do not force generated-app rules onto non-generated SDK
consumers.

| Adapter | Auth | Use |
|---|---|---|
| `createFnfWebAdapter({ baseUrl, getToken, workspaceId? })` | Clerk Bearer token plus optional `hf-workspace-id` | product/in-app flows |
| `createDevFnfWebAdapter({ userId, workspaceId? })` | `hf-dev-user-id` plus optional `hf-workspace-id`; base URL defaults to dev | dev backend smoke tests and local sandboxes only |
| `createAppsMarketplaceAdapter({ userId, workspaceId? })` | `fnf-apps-marketplace-secret` from `secret` or `FNF_APPS_MARKETPLACE_SECRET` + `hf-user-id`; base URL defaults to `https://dev-fnf.higgsfield.ai/apps-marketplace` | trusted server-side apps-marketplace proxy/sdk smoke tests; dev-only backend mount for now |
| `createWorkflowPlatformAdapter({ baseUrl, observability? })` — BUNDLED in `@higgsfield/fnf/workflow-platform` | platform-attached server identity; no bearer token | generated apps and Supercomputer flows through `https://fnf.internal` |
| `createMemoryBackend()` / `createMemoryMediaAdapter()` / `createMemoryProfileAdapter()` | none | tests, examples, offline demos |

Every generation adapter factory above also accepts a `confirm` option — the
host's submission confirmation gate (see "Submission confirmation gate" under
Job recipes). Hosts that submit generations for a user must pass it.

```ts
import { createJobClient } from '@higgsfield/fnf/client'
import { createMediaClient } from '@higgsfield/fnf/media'
import { createProfileClient } from '@higgsfield/fnf/profile'
import { createWorkflowPlatformAdapter } from '@higgsfield/fnf/workflow-platform'
import { seedance2_0 } from '@higgsfield/fnf/jobs'

const adapter = createWorkflowPlatformAdapter({
  baseUrl: 'https://fnf.internal',
})

const jobs = createJobClient({ adapter, jobs: [seedance2_0] })
const media = createMediaClient({ mediaAdapter: adapter })
const profile = createProfileClient({ profileAdapter: adapter })
```

Generated apps must put this fnf.internal adapter server-side behind app-local
server functions or `/api/*` routes. Other hosts may use their matching adapter
or a custom backend-port implementation. Do not expose dev user ids, bearer
tokens, or workspace secrets to arbitrary visitors.

Apps Marketplace uses a different trusted-service header contract from the
normal dev adapter. The backend mount is intentionally dev-only for now, and
the service secret must never be shipped to browser code. This adapter is for
SDK smoke tests and trusted service experiments, not generated apps:

```ts
import { createAppsMarketplaceAdapter } from '@higgsfield/fnf-adapters'

const adapter = createAppsMarketplaceAdapter({
  userId: actingUserId,
  workspaceId,
})
```

By default, the adapter reads `FNF_APPS_MARKETPLACE_SECRET` from the server
environment. Pass `secret` for tests/custom secret loading, or `secretEnv` when
the host uses a different env var name.

The adapter returns the same `FnfAdapter` shape as `createFnfWebAdapter`, so pass
it to `createJobClient`, `createMediaClient`, and `createProfileClient` exactly
the same way. Do not duplicate route/body logic for `/apps-marketplace`; it
mirrors the existing fnf routers behind different auth headers.

For generated apps, use the Workflow Platform adapter against
`https://fnf.internal`. It sends static, versionable routes under `/user`,
`/workspaces/*`, `/reference-elements/*`, `/custom-references/*`, and
`/jobs/*`; the platform behind fnf.internal resolves the final internal
endpoints and body quirks. The SDK still handles model
validation, camelCase settings, `z.wire` serialization, media refs, profile
mapping, costs, polling, and typed errors.

```ts
import { createWorkflowPlatformAdapter } from '@higgsfield/fnf/workflow-platform'

const adapter = createWorkflowPlatformAdapter({
  baseUrl: 'https://fnf.internal',
  observability,
})
```

In generated apps, do not use env-controlled backend URL selectors, public fnf
URLs, dev fnf URLs, apps marketplace URLs, `getToken`, `Authorization`,
`hf-dev-user-id`, or service secrets. The platform attaches identity
automatically to server-side `https://fnf.internal` egress. In non-generated
hosts, follow that host's explicit adapter/auth contract instead.

fnf.internal method contract:

- Submit goes through `POST /jobs/submit`.
- Cost goes through `POST /jobs/cost`.
- Cancel goes through `POST /jobs/{job_id}/cancel`.
- Media presign goes through `POST /jobs/media/presign`.
- Media confirm goes through `POST /jobs/media/{media_id}/confirm`.
- Job reads go through `GET /jobs/{job_id}`, `GET /jobs/sets/{job_set_id}`,
  and the feed route `GET /jobs?gen_type=<image|video|...>`.
- Media reads go through `GET /jobs/media/{media_id}` and `GET /jobs/media`.
- Element reads go through `GET /reference-elements/{element_id}` and
  `GET /reference-elements`.
- Character training goes through `POST /custom-references`; lifecycle reads
  go through `GET /custom-references/{character_id}`.
- User/profile reads go through `GET /user`.
- Workspace reads go through `GET /workspaces`, `GET /workspaces/current`,
  and `GET /workspaces/wallet`.
- Workspace switch goes through `POST /workspaces/switch`.

Do not hand-write `fetch('/jobs')` with an `operation` body,
`fetch('/jobs?operation=submit')`, or model-specific fnf routes in generated
apps. Use `createJobClient`, `createMediaClient`, and `createProfileClient`
with `createWorkflowPlatformAdapter`. If an app wraps SDK calls in TanStack
server functions or `/api/*` routes, submit/cost/media routes must be `POST`,
not `GET`. A 405 / "Method Not Allowed" on generation is usually this method or
stale SDK snapshot mismatch.

## Elements and custom-reference character recipes

Elements are the user's reusable asset library; Characters are one Element
kind. Character training is a separate multi-image operation that creates a
processing Character Element. Do not wrap Elements in a character-only
abstraction and do not add presets to this flow.

```ts
import { createCharacterClient } from '@higgsfield/fnf/characters'
import { createJobClient } from '@higgsfield/fnf/client'
import { soulV2Image } from '@higgsfield/fnf/jobs'
import { createReferenceClient } from '@higgsfield/fnf/references'

const references = createReferenceClient({ adapter })
const characters = createCharacterClient({ adapter })
const jobs = createJobClient({ adapter, jobs: [soulV2Image] })

const existing = await references.list({ category: 'character', size: 50 })

const pending = await characters.create({
  name: 'My character',
  type: 'soul_2',
  images, // 1–100 MediaRef values; upload browser Files first
})
const character = await characters.wait(pending)

if (character.status === 'completed') {
  await jobs.submit({
    model: 'text2image_soul_v2',
    prompt: { instruction: 'Candid flash photo at a late-night diner' },
    settings: { customReferenceId: character.id, batchSize: 4 },
  })
}
```

Rules:

- Supported types are `soul`, `soul_2` (default), and
  `soul_cinematic`; use the generic custom-reference route for all of them.
- `soul` accepts uploaded `media_input` refs only. `soul_2` and
  `soul_cinematic` also accept compatible image job refs ending in `_job`.
- Poll to `completed` or `failed`, then refresh the Elements query.
- Existing Character Elements expose `reference.characterId`; generation
  uses that value as `settings.customReferenceId`. Element id and character
  id are different.
- Use `references.list/get` and `characters.create/get/wait`; never
  hand-write the underlying routes.

### LLM (chat completions) — same zero-token rail

Generated apps reach the platform LLM through the SAME zero-token egress rail
as `fnf.internal` jobs — construct the client with the `/llm` mount and NO
`getToken`/`userId`; the platform attaches the signed-in visitor's identity on
egress, and spend is billed to that visitor's credits:

```ts
import { createLlmClient } from '@higgsfield/fnf'

// Worker-side only (server functions / `/api/*` routes) — never browser code.
const llm = createLlmClient({ baseUrl: 'https://fnf.internal/llm' })

const [model] = await llm.listModels()
if (!model) throw new Error('No LLM models are currently available')

const res = await llm.complete({
  model,
  messages: [{ role: 'user', content: 'One-line haiku about renders.' }],
})

for await (const chunk of llm.stream({
  model,
  messages: [{ role: 'user', content: 'Stream me a haiku.' }],
})) {
  // chunk.choices[0].delta.content — SSE deltas, OpenAI-compatible shape
}
```

Rules: do NOT pass `getToken`, `userId`, or any secret on this rail (the README's
external `fnf-api-gw` + `getToken` example is for NON-generated first-party hosts
only); Worker-side only. Model availability is runtime gateway configuration:
call `listModels()` server-side, use exact returned ids, handle an empty list,
and never hardcode a catalog. A React model picker may receive those ids through
an authenticated app-local server function or route. Pass only a browser-safe
proxy backend to `FnfProvider` as `llm`; never pass the raw internal client to
client-rendered code (see `@higgsfield/fnf-react`'s `ai/AGENTS.md`).

Apps Marketplace uses a different trusted-service header contract from the
normal dev adapter. The backend mount is intentionally dev-only for now, and
the service secret must never be shipped to browser code. This adapter is for
SDK smoke tests and trusted service experiments, not generated apps:

```ts
import { createAppsMarketplaceAdapter } from '@higgsfield/fnf-adapters'

const adapter = createAppsMarketplaceAdapter({
  userId: actingUserId,
  workspaceId,
})
```

By default, the adapter reads `FNF_APPS_MARKETPLACE_SECRET` from the server
environment. Pass `secret` for tests/custom secret loading, or `secretEnv` when
the host uses a different env var name.

The adapter returns the same `FnfAdapter` shape as `createFnfWebAdapter`, so pass
it to `createJobClient`, `createMediaClient`, and `createProfileClient` exactly
the same way. Do not duplicate route/body logic for `/apps-marketplace`; it
mirrors the existing fnf routers behind different auth headers.

For generated apps, use the Workflow Platform adapter against
`https://fnf.internal`. It sends static, versionable routes under `/user`,
`/workspaces/*`, and `/jobs/*`; the platform behind fnf.internal resolves the
final internal endpoints and body quirks. The SDK still handles model
validation, camelCase settings, `z.wire` serialization, media refs, profile
mapping, costs, polling, and typed errors.

```ts
import { createWorkflowPlatformAdapter } from '@higgsfield/fnf/workflow-platform'

const adapter = createWorkflowPlatformAdapter({
  baseUrl: 'https://fnf.internal',
  observability,
})
```

In generated apps, do not use env-controlled backend URL selectors, public fnf
URLs, dev fnf URLs, apps marketplace URLs, `getToken`, `Authorization`,
`hf-dev-user-id`, or service secrets. The platform attaches identity
automatically to server-side `https://fnf.internal` egress. In non-generated
hosts, follow that host's explicit adapter/auth contract instead.

fnf.internal method contract:

- Submit goes through `POST /jobs/submit`.
- Cost goes through `POST /jobs/cost`.
- Cancel goes through `POST /jobs/{job_id}/cancel`.
- Media presign goes through `POST /jobs/media/presign`.
- Media confirm goes through `POST /jobs/media/{media_id}/confirm`.
- Job reads go through `GET /jobs/{job_id}`, `GET /jobs/sets/{job_set_id}`,
  and the feed route `GET /jobs?gen_type=<image|video|...>`.
- Media reads go through `GET /jobs/media/{media_id}` and `GET /jobs/media`.
- User/profile reads go through `GET /user`.
- Workspace reads go through `GET /workspaces`, `GET /workspaces/current`,
  and `GET /workspaces/wallet`.
- Workspace switch goes through `POST /workspaces/switch`.

Do not hand-write `fetch('/jobs')` with an `operation` body,
`fetch('/jobs?operation=submit')`, or model-specific fnf routes in generated
apps. Use `createJobClient`, `createMediaClient`, and `createProfileClient`
with `createWorkflowPlatformAdapter`. If an app wraps SDK calls in TanStack
server functions or `/api/*` routes, submit/cost/media routes must be `POST`,
not `GET`. A 405 / "Method Not Allowed" on generation is usually this method or
stale SDK snapshot mismatch.

## Job recipes

Register only the jobs the host can actually use. The `jobs: [...]` registry is
what gives `model`, `settings`, and media roles their TypeScript narrowing.

```ts
import { createJobClient } from '@higgsfield/fnf/client'
import { seedance2_0 } from '@higgsfield/fnf/jobs'

const client = createJobClient({ adapter, jobs: [seedance2_0] })

const { generations } = await client.submit({
  model: 'seedance_2_0',
  prompt: { instruction: 'cinematic lightning over the ocean' },
  settings: {
    mode: 'std',
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    batchSize: 1,
  },
})

const [done] = await client.wait(generations, {
  signal,
  onProgress: generation => {
    console.log(generation.status)
  },
})

console.log(done.results?.rawUrl)
```

Useful client calls:

- `submit(input)` submits immediately and returns generations.
- `safeSubmit(input)` returns `{ ok: true, ... } | { ok: false, error }`.
- `adjust(input, ['near-aspect-ratio', 'near-duration'])` explicitly snaps
  values; `submit` itself does not normalize.
- `cost(input)` returns display credits for UI previews.
- `get(id)`, `getSet(jobSetId)`, `poll(id)`, and `wait(generations)` read and
  poll generation state.
- `cancel(id)` cancels queued jobs when the adapter supports it.
- `list(opts)` reads the generation feed; handle typed `not_supported` for
  filters the backend route cannot support.

When regenerating, submit the parsed read-model input back through the same
client and registry:

```ts
await client.submit(done.input as Parameters<typeof client.submit>[0])
```

### Submission confirmation gate

If the host submits generations on behalf of a user, implement the `confirm`
gate — pass it to the adapter factory (all generation adapters accept it).
Embedded apps must call the platform's injected approval API with the exact
`jobSetType` and final wire `params`, return its token unchanged, and must not
open an additional browser or custom dialog. Standalone UI hosts own their
approval modal. `submit` calls the gate after validation and wire-param
building, before any network call. Because confirmation tokens are single-use,
`submit` rejects `count > 1` before invoking the gate; use the model's
`batchSize` setting when it supports multiple outputs in one request.

Contract (`ConfirmSubmit` from `@higgsfield/fnf`):

- Resolve to proceed. Resolving with a string sends it as top-level
  `confirmation_token` on the create request (e.g. a token minted by the
  host's own confirm endpoint or modal flow).
- Resolve with nothing only when the standalone host's approval flow is tokenless.
- Reject/throw to abort: `submit` fails with the typed
  `confirmation_rejected` error and no request is sent. Branch on
  `error.code === 'confirmation_rejected'` — user declined is not a failure.

```ts
const adapter = createFnfWebAdapter({
  baseUrl,
  getToken,
  // An embedded host owns the security UI and mints the intent token.
  confirm: ({ jobSetType, params }) =>
    platformApproval.requestGeneration(jobSetType, params),
})
```

Do not auto-confirm (`confirm: async () => {}` in a real UI host defeats the
gate), and never log or emit the token through observability.

## Media recipes

Media is a separate client. Upload and resolve APIs produce `MediaRef` objects
that job media codecs know how to serialize.

Strict upload rule for generated apps and server bridges: binary files do not go
through JSON. Never pass browser `File`, `Blob`, `ArrayBuffer`, `Uint8Array`,
base64 strings, or byte arrays through `createServerFn` input or a JSON request
body. Use multipart `FormData` to an app-local `POST /api/media/upload` route,
read `await file.arrayBuffer()` server-side, call `media.upload({ source:
bytes, ... })`, and return only the submit-ready `MediaRef`. The later
generation request should contain prompt/settings/`MediaRef` only.

Bad patterns:

```ts
await generate({ data: { file } })                 // bad: File through JSON
await generate({ data: { bytes: Array.from(u8) } }) // bad: huge JSON
String.fromCharCode(...u8)                         // bad: stack overflow
```

Good shape:

```txt
browser File -> POST multipart /api/media/upload -> media.upload -> MediaRef
MediaRef + prompt/settings -> POST /api/generate -> jobs.submit
```

```ts
import { createMediaClient, createDomMediaMetaResolver, resolveMediaMeta } from '@higgsfield/fnf/media'

const media = createMediaClient({ mediaAdapter: adapter })

const { ref } = await media.upload({
  source: fileBytes,
  filename: 'frame.png',
  type: 'image',
  forceIpCheck: true,
})

const input = {
  model: 'seedance_2_0' as const,
  media: { start_image: [ref] },
  prompt: { instruction: 'animate this frame' },
  settings: { duration: 5, aspectRatio: 'auto' as const },
}

const measured = await resolveMediaMeta(input, createDomMediaMetaResolver())
await jobs.submit(measured)
```

Notes:

- `media.upload({ source })` accepts only `Blob`, `ArrayBuffer`, `Uint8Array`, or
  a lazy `{ read() }` returning one of those. Invalid JSON-shaped sources fail
  early with `invalid_media_source`.
- `MediaRef.meta` never goes to the backend; it only powers local validation and
  local aspect/size derivation.
- `uploadFromUrl` is convenience, not SSRF protection. For server-side
  untrusted URLs, inject a hardened uploader/fetcher with private-IP, redirect,
  byte-size, and content-type policy.
- Moderation/IP results are data. Use `safeUploadMedia` when crossing process
  boundaries.

## Profile and workspace recipes

The profile client is the SDK account/workspace domain. It is not the app's
creator-profile entity.

```ts
import { createProfileClient } from '@higgsfield/fnf/profile'

const profile = createProfileClient({ profileAdapter: adapter })

const user = await profile.getUser()
const workspaces = await profile.listWorkspaces()
const currentWorkspace = await profile.getCurrentWorkspace()
const wallet = await profile.getWallet()
const credits = await profile.getCredits({ includeOnDemand: true })
const snapshot = await profile.getSnapshot()

await profile.switchWorkspace({ workspaceId: workspaces[0].id })
```

Public fields are camelCase:

- user: `workspaceId`, `workspaceType`, `workspaceRole`, `planType`,
  `billingPeriod`, `totalPlanCredits`
- workspace: `clerkOrganizationId`, `avatarUrl`, `isOwner`
- wallet: `subscriptionBalance`, `subscriptionTotal`, `creditsBalance`,
  `onDemandCredits`

Credit display rule:

```ts
wallet?.subscriptionBalance          // raw backend credit-cents; not for UI
credits?.totalAvailableCredits       // display credits; safe for UI
credits?.raw.totalAvailableCredits   // raw value for debug/accounting only
```

`profile.getCredits()` returns a `ProfileCredits` object, not a number. Never
write `typeof credits === 'number'`; use one of the display fields above.

`switchWorkspace()` posts backend context and returns a fresh snapshot. Host
apps still own Clerk/session metadata, React Query invalidation, and adapter
header state.

## Observability recipes

Observability is a vendor-neutral observer callback. The SDK does not send
telemetry anywhere by itself.

```ts
import { createJobClient } from '@higgsfield/fnf/client'
import { createConsoleObserver } from '@higgsfield/fnf/observability'

const observer = createConsoleObserver()

const client = createJobClient({
  adapter,
  jobs: [seedance2_0],
  observability: {
    observer,
    traceId: requestId,
    attributes: { surface: 'sandbox' },
  },
})
```

Expected event names include:

- jobs: `fnf.job.submit`, `fnf.job.cost`, `fnf.job.get`, `fnf.job.get_set`,
  `fnf.job.list`, `fnf.job.cancel`, `fnf.job.wait`, `fnf.job.poll`
- media: `fnf.media.upload`, `fnf.media.presign`, `fnf.media.transfer`,
  `fnf.media.confirm`, `fnf.media.get`, `fnf.media.list`, `fnf.media.resolve`
- profile: `fnf.profile.get_user`, `fnf.profile.list_workspaces`,
  `fnf.profile.get_current_workspace`, `fnf.profile.get_wallet`,
  `fnf.profile.get_credits`, `fnf.profile.get_snapshot`,
  `fnf.profile.switch_workspace`
- transport/backend wrappers: `fnf.transport.request` and
  `fnf.backend.*` wrapper spans

Observer errors are caught and never change SDK behavior. Async observer
promises are intentionally not awaited.

Privacy rule: never add prompts, request bodies, raw params, auth headers,
tokens, upload/result URLs, filenames, emails, workspace names, or file bytes to
event attributes. Bridge the safe observer events to Sentry, Datadog,
OpenTelemetry, console logs, or product analytics in host code.

## Current SDK catalog

Import catalog entries from `@higgsfield/fnf/jobs` and register them with
`createJobClient({ jobs: [...] })`.

Image:

- `soulV2Image` -> `text2image_soul_v2`
- `soulCinemaImage` -> `soul_cinematic`
- `gptImage2` -> `gpt_image_2`
- `seedreamV4_5`
- `nanoBanana2` -> `nano_banana_2`
- `nanoBananaFlash` -> `nano_banana_flash`
- `recraftV41Image`

Video:

- `seedance2_0` with `settings.mode: 'std' | 'fast'`
- `kling3_0`
- `kling3MotionControl`
- `happyHorse`
- `grokImagine`
- `grokImagineV15`
- `veo3_1Lite`
- `wan27`

Upscale:

- `topazImageUpscale`
- `topazImageGenerativeUpscale`
- `nanoBanana2Upscale`
- `topazVideoUpscale`
- `higgsfieldVideoUpscale`
- `soraEnhanceVideo`
- `bytedanceVideoUpscale`

Legacy/currently supported baseline:

- `klingVideo`
- `textToImageSoul`

## Errors and boundaries

All SDK errors extend `ApiJobError` with stable `code`, optional `status`, and
typed `data`. `toJSON()` is uniform; `errorFromJSON` restores SDK error classes
when needed.

Common codes: `validation`, `out_of_credits`, `rate_limit`,
`minimum_plan_required`, `prompt_nsfw`, `ip_detected`,
`ip_check_rate_limit_reached`, `job_failed`, `timeout`, `aborted`,
`not_supported`, `media_too_large`, `request_timeout`,
`confirmation_rejected` (the host's `confirm` gate declined the submission —
a user choice, not a failure).

For UI and worker/iframe boundaries, branch on `error.code`:

```ts
const result = await client.safeSubmit(input)

if (!result.ok) {
  if (result.error.code === 'out_of_credits') {
    // show billing/credits UI
  }
}
```

Avoid:

```ts
try {
  await client.submit(input)
}
catch (error) {
  if (error instanceof OutOfCreditsError) {
    // fragile across postMessage/Comlink/JSON boundaries
  }
}
```

## Anti-patterns

### Do not fetch product job routes directly

```ts
await fetch(`${baseUrl}/jobs/v2/seedance_2_0`, { body: JSON.stringify(params) }) // bad
await client.submit({ model: 'seedance_2_0', prompt, settings })                 // good
```

Direct fetches bypass validation, route/body special cases, typed errors,
cost logic, restore/finalize round-trips, and observability.

Generated apps must use `createWorkflowPlatformAdapter` against
`https://fnf.internal` rather than direct fnf product routes. The adapter may
call only `/user`, `/workspaces/*`, and `/jobs/*`; do not add `/jobs/v2/*`,
`/job-sets/*`, `/media/*`, `/video`, `/audio`, or `/workspaces/details` paths to
generated app code.

### Do not use backend snake_case in public settings

```ts
settings: { aspect_ratio: '9:16', batch_size: 2 } // bad; stripped by schema
settings: { aspectRatio: '9:16', batchSize: 2 }   // good
extra: { experimental_backend_flag: true }        // good only when deliberate
```

### Do not display raw wallet balances

```ts
wallet.subscriptionBalance                  // bad for UI; raw credit-cents
snapshot.credits?.monthlyRemaining          // good display credits
snapshot.credits?.raw.monthlyRemaining      // good only for debug/accounting
await client.cost(seedanceInput)            // good model preview; 2250 cents -> 23 credits
```

### Do not leak private payloads into observability

```ts
attributes: { prompt: input.prompt.instruction } // bad
attributes: { model: input.model }               // good
```

### Do not assume all adapters support all optional calls

Generic tools should handle `error.code === 'not_supported'` for operations
such as unsupported list filters, unavailable media listing, missing cancel
support, or backend-only costs.

## Extending the SDK catalog

Use `defineJob({ jobSetType, outputType, params, validate, credits, finalize,
restore })`. The public settings schema should be camelCase; wire names belong
in `z.wire`.

Non-negotiables:

1. Ground product constants in fnf-web and fnf-api behavior; cite provenance in
   comments where existing jobs do.
2. Reuse helpers in `jobs/checks.ts`, `jobs/dimensions.ts`,
   `jobs/video-helpers.ts`, `jobs/image-helpers.ts`, and
   `jobs/upscale-helpers.ts` before adding one-off logic.
3. If `finalize` deletes, renames, or derives settings, add `restore` so
   get-then-resubmit round-trips parsed generations correctly.
4. Export new jobs from `src/jobs/index.ts` and the root barrel.
5. Update `createFnfWebAdapter` route/body/cost behavior (in
   `@higgsfield/fnf-adapters`) when the product route is not the generic
   `/jobs/{jobSetType}` shape.
6. Add tests for defaults, validations, media role/count/meta rules, cost,
   adapter route/body shape, parse/build round-trips, and typed API coverage.
7. For docs/type tests, use `expectType<T>(value)` instead of bare property
   access expressions; ESLint treats bare expressions as unused.

Focused package checks:

```sh
yarn workspace @higgsfield/fnf test
yarn workspace @higgsfield/fnf typecheck
yarn workspace @higgsfield/fnf-adapters test
yarn workspace @higgsfield/fnf-adapters typecheck
```

The client/media/profile wire-parity tests (exact adapter routes and bodies)
live in `packages/fnf-adapters/src/__tests__`; `@higgsfield/fnf` keeps the
port-level unit tests only.

Do not run the full app build, `next build`, or `ci:build` in this workspace.

## When in doubt

1. Read the job declaration in `src/jobs/<model>.ts`.
2. Read `README.md` for the deeper SDK lifecycle and adapter model.
3. Read the nearest product-parity test in `src/jobs/__tests__/`.
4. Check `src/errors.ts` before branching on an error.
5. Do not guess backend wire behavior; confirm it in product/backend source and
   encode it through the SDK surface.
