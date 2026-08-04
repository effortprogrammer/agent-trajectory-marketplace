import type { Generation } from '@higgsfield/fnf/client'
import { RefCountPool } from './pool'

/**
 * The connection port — inject whatever the app has. fnf-web today: SSE per
 * job set (`GET /sse/{type}?job_set_id=` — wrap `createSseConnection` /
 * the app's `Realtime.pool` here in a few lines); tomorrow: a websocket.
 * Return the close function, or `undefined` when this generation has NO
 * realtime channel (not every job type has an SSE route) — the caller falls
 * back to polling for those.
 *
 * Event payloads deliberately stop at this boundary: an event means
 * "something changed", and the fresh state is re-read through the client —
 * no wire shapes leak up.
 */
export type RealtimeTransport = (
  generation: Generation,
  emit: () => void,
) => (() => void) | undefined

/** One live channel (a job set): a single connection, N listeners. */
class RealtimeChannel {
  private readonly listeners = new Set<() => void>()
  private close: (() => void) | undefined

  /** Whether the transport actually opened a connection for this channel. */
  connected = false

  open(transport: RealtimeTransport, generation: Generation): void {
    // A throwing transport means "no channel", not a crash in the caller's
    // React effect — errors are state here too; the caller polls instead.
    try {
      this.close = transport(generation, () => {
        for (const listener of this.listeners) listener()
      })
    }
    catch {
      this.close = undefined
    }
    this.connected = this.close !== undefined
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  free(): void {
    this.close?.()
    this.close = undefined
    this.listeners.clear()
  }
}

/**
 * Live updates over refcounted channels — the fnf-web `Realtime` +
 * `RefCountClassPool` shape, transport-agnostic. One connection per job set
 * no matter how many subscribers (a feed, a tile, a toast); the last
 * unsubscribe closes it after `freeGraceMs`, so quick re-subscribes (a feed
 * effect re-running) reuse the live connection instead of reconnecting.
 */
export class Realtime {
  private readonly channels: RefCountPool<Generation, RealtimeChannel>

  constructor(transport: RealtimeTransport, options?: { freeGraceMs?: number }) {
    this.channels = new RefCountPool(
      generation => generation.jobSetId ?? generation.id,
      (generation) => {
        const channel = new RealtimeChannel()
        channel.open(transport, generation)
        return channel
      },
      { freeGraceMs: options?.freeGraceMs ?? 1000 },
    )
  }

  /**
   * Listen for this generation's channel events. Returns the unsubscribe
   * (idempotent — extra calls are a no-op, they can't close a channel under
   * another subscriber), or `undefined` when the transport has no channel
   * for it (poll instead).
   */
  subscribe(generation: Generation, listener: () => void): (() => void) | undefined {
    const channel = this.channels.allocate(generation)
    if (!channel.connected) {
      this.channels.free(generation)
      return undefined
    }
    const unsubscribe = channel.subscribe(listener)
    let done = false
    return () => {
      if (done)
        return
      done = true
      unsubscribe()
      this.channels.free(generation)
    }
  }
}
