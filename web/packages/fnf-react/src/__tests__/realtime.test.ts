import type { Generation } from '@higgsfield/fnf/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RefCountPool } from '../pool'
import { Realtime } from '../realtime'

function gen(id: string, jobSetId?: string): Generation {
  return { id, model: 'demo', type: 'image', status: 'queued', input: { model: 'demo', settings: {} }, ...(jobSetId ? { jobSetId } : {}) }
}

describe('Realtime (refcounted channels)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shares ONE connection per job set across subscribers; the last unsubscribe closes it', () => {
    let opened = 0
    let closed = 0
    const live = new Realtime(() => {
      opened++
      return () => closed++
    }, { freeGraceMs: 0 })

    const a = live.subscribe(gen('a', 'set-1'), () => {})
    const b = live.subscribe(gen('b', 'set-1'), () => {})
    expect(opened).toBe(1) // one channel for the whole set

    a?.()
    expect(closed).toBe(0) // b still listening
    b?.()
    expect(closed).toBe(1)
  })

  it('events fan out to every listener on the channel', () => {
    let fire: (() => void) | undefined
    const live = new Realtime((_g, emit) => {
      fire = emit
      return () => {}
    })
    const seen: string[] = []
    live.subscribe(gen('a', 'set-1'), () => seen.push('a'))
    live.subscribe(gen('b', 'set-1'), () => seen.push('b'))

    fire?.()

    expect(seen.sort()).toEqual(['a', 'b'])
  })

  it('the grace window survives quick re-subscribes without reconnecting', () => {
    let opened = 0
    let closed = 0
    const live = new Realtime(() => {
      opened++
      return () => closed++
    }, { freeGraceMs: 1000 })

    const first = live.subscribe(gen('a', 'set-1'), () => {})
    first?.() // effect re-run: unsubscribe...
    live.subscribe(gen('a', 'set-1'), () => {}) // ...and resubscribe within the grace

    vi.advanceTimersByTime(2000)
    expect(opened).toBe(1) // the live connection was reused
    expect(closed).toBe(0)

    // and the grace DOES close an abandoned channel
    const second = live.subscribe(gen('z', 'set-2'), () => {})
    second?.()
    vi.advanceTimersByTime(2000)
    expect(closed).toBe(1)
  })

  it('returns undefined when the transport has no channel (poll those instead)', () => {
    const live = new Realtime(g => (g.jobSetId === 'covered' ? () => {} : undefined))

    expect(live.subscribe(gen('a', 'covered'), () => {})).toBeDefined()
    expect(live.subscribe(gen('b', 'legacy-type'), () => {})).toBeUndefined()
  })

  it('a THROWING transport means "no channel", not a crash in the caller', () => {
    const live = new Realtime(() => {
      throw new Error('new WebSocket(...) blew up')
    }, { freeGraceMs: 0 })

    expect(live.subscribe(gen('a', 'set-1'), () => {})).toBeUndefined()
    // and the failed open didn't leak a refcount on the channel key
    expect(live.subscribe(gen('a', 'set-1'), () => {})).toBeUndefined()
  })

  it('unsubscribe is idempotent — extra calls cannot close a channel under another subscriber', () => {
    let closed = 0
    let fire: (() => void) | undefined
    const live = new Realtime((_g, emit) => {
      fire = emit
      return () => closed++
    }, { freeGraceMs: 0 })

    const seen: string[] = []
    const a = live.subscribe(gen('a', 'set-1'), () => seen.push('a'))
    live.subscribe(gen('b', 'set-1'), () => seen.push('b'))

    a?.()
    a?.() // a double cleanup (a buggy consumer) must be a no-op
    fire?.()

    expect(closed).toBe(0) // b's channel survived
    expect(seen).toEqual(['b'])
  })
})

describe('RefCountPool', () => {
  it('allocate shares an instance; the last free disposes it', () => {
    const freed: string[] = []
    const pool = new RefCountPool(
      (id: string) => id,
      id => ({ id, free: () => freed.push(id) }),
    )

    const one = pool.allocate('x')
    const two = pool.allocate('x')
    expect(two).toBe(one)

    pool.free('x')
    expect(freed).toEqual([])
    pool.free('x')
    expect(freed).toEqual(['x'])
    expect(pool.has('x')).toBe(false)
  })

  it('ensure gets-or-creates without taking a reference (render-phase safe)', () => {
    const freed: string[] = []
    const pool = new RefCountPool(
      (id: string) => id,
      id => ({ id, free: () => freed.push(id) }),
    )

    const ensured = pool.ensure('x')
    expect(pool.allocate('x')).toBe(ensured)
    pool.free('x') // releases the ONE allocate reference
    expect(freed).toEqual(['x'])
  })

  it('extra frees are a no-op — the count never underflows a live instance', () => {
    const freed: string[] = []
    const pool = new RefCountPool(
      (id: string) => id,
      id => ({ id, free: () => freed.push(id) }),
    )

    pool.free('never-allocated') // must not throw, must not dispose anything
    expect(freed).toEqual([])

    pool.allocate('x')
    pool.free('x')
    pool.free('x') // double free after full release
    expect(freed).toEqual(['x'])

    // the key is fully reusable afterwards
    pool.allocate('x')
    expect(pool.has('x')).toBe(true)
    pool.free('x')
    expect(freed).toEqual(['x', 'x'])
  })

  it('a factory throw does not leak a reference', () => {
    const freed: string[] = []
    let boom = true
    const pool = new RefCountPool(
      (id: string) => id,
      (id) => {
        if (boom) {
          boom = false
          throw new Error('factory blew up')
        }
        return { id, free: () => freed.push(id) }
      },
    )

    expect(() => pool.allocate('x')).toThrow('factory blew up')

    pool.allocate('x') // works now — and holds the ONLY reference
    pool.free('x') // would NOT dispose here if the throw above had leaked a ref
    expect(freed).toEqual(['x'])
  })
})
