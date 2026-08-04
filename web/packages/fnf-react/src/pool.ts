/**
 * Refcounted instance pool — the fnf-web `RefCountClassPool` pattern
 * (shared/lib/ref-count-class-pool.ts), dependency-free. Share one stateful
 * instance (a controller, a realtime channel) between consumers: `allocate`
 * gets-or-creates and increments, `free` decrements and disposes the instance
 * (calls its `free()`) when the last consumer leaves — after `freeGraceMs`,
 * so quick unmount/remount cycles reuse the live instance instead of
 * rebuilding it.
 */
export interface PoolEntry {
  free: () => void
}

export class RefCountPool<Id, Instance extends PoolEntry> {
  private readonly instances = new Map<string, Instance>()
  private readonly refs = new Map<string, number>()
  private readonly freeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly freeGraceMs: number

  constructor(
    private readonly hash: (id: Id) => string,
    private readonly factory: (id: Id) => Instance,
    options?: { freeGraceMs?: number },
  ) {
    this.freeGraceMs = options?.freeGraceMs ?? 0
  }

  /** Get-or-create AND take a reference (pair every allocate with a free). */
  allocate(id: Id): Instance {
    const key = this.hash(id)
    const instance = this.ensure(id) // a factory throw must not leak a ref
    const pending = this.freeTimers.get(key)
    if (pending) {
      clearTimeout(pending)
      this.freeTimers.delete(key)
    }
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1)
    return instance
  }

  /** Release a reference; the last one disposes the instance (after the grace). Extra frees are a no-op — never underflow a live instance. */
  free(id: Id): void {
    const key = this.hash(id)
    const current = this.refs.get(key)
    if (current === undefined)
      return // never allocated, or already fully freed (a double-free)
    if (current > 1) {
      this.refs.set(key, current - 1)
      return
    }
    this.refs.delete(key)
    if (this.freeGraceMs > 0) {
      this.freeTimers.set(key, setTimeout(() => {
        this.freeTimers.delete(key)
        this.dispose(key)
      }, this.freeGraceMs))
    }
    else {
      this.dispose(key)
    }
  }

  /** Get-or-create WITHOUT touching the ref count — safe in a render phase. */
  ensure(id: Id): Instance {
    const key = this.hash(id)
    const existing = this.instances.get(key)
    if (existing)
      return existing
    const created = this.factory(id)
    this.instances.set(key, created)
    return created
  }

  get(id: Id): Instance | undefined {
    return this.instances.get(this.hash(id))
  }

  has(id: Id): boolean {
    return this.instances.has(this.hash(id))
  }

  private dispose(key: string): void {
    this.instances.get(key)?.free()
    this.instances.delete(key)
  }
}
