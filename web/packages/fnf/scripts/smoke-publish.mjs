/**
 * Smoke test for the packed tarball. Runs in a scratch project where the
 * tarball has been extracted to node_modules/@higgsfield-ai/fnf and nothing
 * else is installed — verifies every public subpath resolves in plain Node
 * ESM, that zod was bundled in (no runtime deps), and that import-time side
 * effects (media error-code registration) survived bundling.
 */
/* eslint-disable import/no-unresolved -- @higgsfield-ai/fnf only exists in the smoke scratch project */
import assert from 'node:assert/strict'

const { createJobClient } = await import('@higgsfield-ai/fnf/client')
const jobs = await import('@higgsfield-ai/fnf/jobs')
const { createMediaClient } = await import('@higgsfield-ai/fnf/media')
const { createProfileClient } = await import('@higgsfield-ai/fnf/profile')
const { createConsoleObserver } = await import('@higgsfield-ai/fnf/observability')
const workflowPlatform = await import('@higgsfield-ai/fnf/workflow-platform')
const { errorFromJSON, ApiJobError } = await import('@higgsfield-ai/fnf/errors')
const root = await import('@higgsfield-ai/fnf')

assert.equal(typeof createJobClient, 'function', 'client subpath broken')
assert.equal(typeof createMediaClient, 'function', 'media subpath broken')
assert.equal(typeof createProfileClient, 'function', 'profile subpath broken')
assert.equal(typeof createConsoleObserver, 'function', 'observability subpath broken')
// The ONE bundled adapter (other adapters live in @higgsfield/fnf-adapters).
assert.equal(typeof workflowPlatform.createWorkflowPlatformAdapter, 'function', 'workflow-platform subpath broken')
assert.equal(typeof workflowPlatform.createFetchTransport, 'function', 'fetch transport missing from workflow-platform subpath')
assert.equal(root.createWorkflowPlatformAdapter, workflowPlatform.createWorkflowPlatformAdapter, 'workflow-platform adapter duplicated across entrypoints')
assert.equal(typeof errorFromJSON, 'function', 'errors subpath broken')
assert.equal(typeof root.createJobClient, 'function', 'root barrel broken')
assert.ok(Object.keys(jobs).length > 0, 'jobs subpath exported nothing')

// Class identity must be shared across subpaths — a per-entry copy of the
// error hierarchy would break instanceof after bundling.
assert.equal(root.ApiJobError, ApiJobError, 'ApiJobError duplicated across entrypoints')

// Media error codes are registered as an import side effect of the media
// module; if tree-shaking/bundling dropped them, rehydration falls back to
// the base class.
const rehydrated = errorFromJSON({ code: 'invalid_media_source', message: 'smoke' })
assert.equal(rehydrated.code, 'invalid_media_source', 'media error code lost in build')
assert.ok(rehydrated instanceof ApiJobError, 'rehydrated error lost its class hierarchy')

// Functional round-trip through an inline in-memory backend (the memory
// adapters live in @higgsfield/fnf-adapters, which this tarball must not
// need): cost, submit, wait to a completed result, and a bad setting rejected
// by the bundled zod pipeline.
const memoryJobs = new Map()
let seq = 0
const client = createJobClient({
  adapter: {
    async createJobs({ jobSetType, params }) {
      const id = `mem_${++seq}`
      memoryJobs.set(id, { id, job_set_type: jobSetType, status: 'completed', params, result_url: `memory://${jobSetType}/${id}.out`, created_at: seq })
      return [id]
    },
    async getJob(id) {
      return memoryJobs.get(id) ?? { id, status: 'failed', fail_reason: 'not found' }
    },
    async listJobs() {
      return { items: [...memoryJobs.values()], next_cursor: null }
    },
    async estimateCost() {
      return { credits: 500 }
    },
  },
  jobs: [jobs.nanoBanana2, jobs.seedance2_0],
})

const cost = await client.cost({
  model: 'nano_banana_2',
  prompt: { instruction: 'smoke lighthouse' },
  settings: { batchSize: 2 },
})
assert.equal(typeof cost.credits, 'number', 'cost estimate broken')

const { generations } = await client.submit({
  model: 'nano_banana_2',
  prompt: { instruction: 'smoke lighthouse' },
  settings: { batchSize: 1 },
})
assert.ok(generations.length >= 1, 'submit returned no generations')
const [done] = await client.wait(generations)
assert.equal(done.status, 'completed', `unexpected status: ${done.status}`)
assert.ok(done.results?.rawUrl?.startsWith('memory://'), `bad result url: ${done.results?.rawUrl}`)

const bad = await client.safeSubmit({
  model: 'seedance_2_0',
  prompt: { instruction: 'smoke' },
  settings: { duration: 999 },
})
assert.equal(bad.ok, false, 'validation should have rejected duration 999')
assert.equal(bad.error.code, 'validation', `expected validation error, got: ${bad.error.code}`)

console.log('smoke ok: subpaths import, single error hierarchy, media codes registered, memory-backend round-trip works')
