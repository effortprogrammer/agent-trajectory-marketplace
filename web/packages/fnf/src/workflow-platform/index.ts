/**
 * The ONE adapter implementation bundled with the SDK: the Workflow Platform
 * adapter for `https://fnf.internal` (generated apps / Supercomputer flows),
 * plus the fetch transport and wire normalization it is built on. Bundled so
 * a host that vendors only `@higgsfield/fnf` is self-sufficient for generated
 * apps. Every other adapter (fnf-web, dev, apps-marketplace, memory) lives in
 * `@higgsfield/fnf-adapters`.
 */
export { createFetchTransport } from './fetch-transport'
export type { FetchTransportOptions } from './fetch-transport'
// Shared product-wire normalization — also consumed by the HTTP adapters in
// @higgsfield/fnf-adapters, so the two packages normalize identically.
export { normalizeJobLike, normalizeJobListBody, normalizeJobSetBody, normalizeProductJob } from './job-response-normalize'
export type { NormalizedJobResponse } from './job-response-normalize'
export { createWorkflowPlatformAdapter } from './workflow-platform-adapter'
export type { WorkflowPlatformAdapterOptions } from './workflow-platform-adapter'
