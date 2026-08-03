# @higgsfield/fnf

Typed SDK for Higgsfield generation jobs, media, and profiles.
The package owns validation, wire serialization, polling, uploads, workspace
reads, and typed errors. Network behavior is supplied through backend adapters.

The full operational contract for agents lives in [`ai/AGENTS.md`](./ai/AGENTS.md).

## Public API

- `@higgsfield/fnf/client` — submit, inspect, poll, wait for, cancel, list,
  and estimate the cost of generation jobs.
- `@higgsfield/fnf/jobs` — built-in model definitions.
- `@higgsfield/fnf/media` — resolve and upload media.
- `@higgsfield/fnf/profile` — user, workspace, wallet, and credit reads.
- `@higgsfield/fnf/observability` — metadata-only SDK telemetry.
- `@higgsfield/fnf/workflow-platform` — the bundled Workflow Platform
  adapter.
- `@higgsfield/fnf/errors` — serializable typed errors.
- `@higgsfield/fnf` — root exports, including the job-definition helpers.

## Generation

```ts
import { createJobClient } from '@higgsfield/fnf/client'
import { nanoBanana2 } from '@higgsfield/fnf/jobs'
import { createWorkflowPlatformAdapter } from '@higgsfield/fnf/workflow-platform'

const adapter = createWorkflowPlatformAdapter({
  baseUrl: 'https://fnf.internal',
})

const jobs = createJobClient({
  adapter,
  jobs: [nanoBanana2],
})

const { generations } = await jobs.submit({
  model: 'nano_banana_2',
  prompt: { instruction: 'A blue cat' },
  settings: {
    aspectRatio: '1:1',
    resolution: '2k',
    batchSize: 1,
  },
})

const [result] = await jobs.wait(generations)
console.log(result.results?.rawUrl)
```

Generated apps should call the Workflow Platform adapter from their server
code. Hosts submitting on behalf of a user must also provide the adapter's
`confirm` gate. Confirmation intents are single-use, so confirmed submissions
must keep the top-level `count` at `1`; use a model's `settings.batchSize` when
it supports multiple outputs in one approved request.

## Defining a job

```ts
import { defineJob, z } from '@higgsfield/fnf'

export const myModel = defineJob({
  jobSetType: 'my_model',
  outputType: 'image',
  params: {
    prompt: true,
    media: {
      field: 'input_images',
      format: 'unwrapped',
      roles: ['image'],
    },
    settings: {
      aspectRatio: z.wire(
        'aspect_ratio',
        z.aspectRatio(['1:1', '16:9']),
      ),
      resolution: z._default(z.enum(['1k', '2k']), '1k'),
    },
  },
})
```

Public settings use camelCase. Use `z.wire` when the backend field has a
different name. Job tests are the executable specification for validation,
serialization, and model parity.

## LLM gateway

`createLlmClient` supports non-streaming completion, streaming completion,
tool calls, and model listing. Keep its platform token on the server.

```ts
import { createLlmClient } from '@higgsfield/fnf'

const llm = createLlmClient({
  baseUrl: process.env.LLM_GATEWAY_URL!,
  getToken: () => getPlatformToken(),
  workspaceId: () => getActiveWorkspaceId(),
  appId: process.env.APP_SLUG,
})

const [model] = await llm.listModels()
if (!model) throw new Error('No LLM models are currently available')

const result = await llm.complete({
  model,
  messages: [{ role: 'user', content: 'Write a one-line haiku.' }],
})

console.log(result.content)
```

`baseUrl` must be the gateway's LLM mount without a trailing `/v1`; the
client appends `/v1/chat/completions` and `/v1/models`.

The gateway's model catalog is runtime configuration. Discover it with
`listModels()` on the server, use exact returned ids, and handle an empty
list. A UI model picker should receive those ids through an authenticated
app-local route; if a selected id is no longer returned, refresh the list and
surface an unavailable-model error instead of silently changing models.
