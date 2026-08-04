import type { Generation, SubmitResult, WaitOptions } from '@higgsfield/fnf/client'
import type { ApiJobErrorJSON } from '@higgsfield/fnf/errors'
import type { FnfObservabilityContext, FnfObservabilityOptions } from '@higgsfield/fnf/observability'
import { ApiJobError } from '@higgsfield/fnf/errors'
import { createObservabilityContext, observeEvent } from '@higgsfield/fnf/observability'
import { ExternalStore } from './external-store'

/**
 * The slice of a job client a run needs — structural, so the real
 * `JobClient`, a context-bound pair of free functions, or an app wrapper all
 * fit. `Input` is inferred from `submit`, so model autocomplete flows through.
 */
export interface GenerationRunClient<Input> {
  submit: (input: Input) => Promise<SubmitResult>
  wait: (generations: Generation[], opts?: WaitOptions) => Promise<Generation[]>
}

export type GenerationRunStatus = 'idle' | 'submitting' | 'generating' | 'completed' | 'failed' | 'aborted'

export interface GenerationRunOptions {
  observability?: FnfObservabilityOptions
}

/**
 * One submit-to-terminal lifecycle as observable state: submit the input,
 * then poll the batch live until every generation settles.
 *
 *   idle → submitting → generating → completed
 *                     ↘ failed / aborted
 *
 * Errors are STATE, not throws (`start` never rejects — the safeSubmit
 * philosophy): read `error` for the run-level failure, `failed`/`warning`
 * for partial fan-out failures, and each generation's own `status` for
 * per-job verdicts (failed/nsfw/ip_detected resolve, they don't throw).
 * Starting again aborts the previous run.
 */
export class GenerationRun<Input> extends ExternalStore {
  private active: AbortController | null = null
  private _status: GenerationRunStatus = 'idle'
  private _generations: Generation[] = []
  private _failed: ApiJobErrorJSON[] = []
  private _warning: string | undefined
  private _error: ApiJobError | undefined
  private readonly observability: FnfObservabilityContext

  constructor(private readonly client: GenerationRunClient<Input>, opts: GenerationRunOptions = {}) {
    super()
    this.observability = createObservabilityContext(opts.observability)
  }

  get status(): GenerationRunStatus {
    return this._status
  }

  /** Live snapshots — updated on every poll tick while generating. */
  get generations(): Generation[] {
    return this._generations
  }

  /** Per-job errors from a `count > 1` fan-out where some jobs failed to submit. */
  get failed(): ApiJobErrorJSON[] {
    return this._failed
  }

  get warning(): string | undefined {
    return this._warning
  }

  /** The run-level failure (submit rejected, polling died) — undefined otherwise. */
  get error(): ApiJobError | undefined {
    return this._error
  }

  get isRunning(): boolean {
    return this._status === 'submitting' || this._status === 'generating'
  }

  /**
   * Submit and poll to terminal. Resolves with the settled generations —
   * `[]` when the submit itself failed (the failure is in `error`).
   */
  async start(input: Input): Promise<Generation[]> {
    this.active?.abort()
    const run = new AbortController()
    this.active = run
    observeEvent(this.observability, 'fnf.react.generation_run.start', inputAttributes(input))
    this._status = 'submitting'
    this._generations = []
    this._failed = []
    this._warning = undefined
    this._error = undefined
    this.commit()

    try {
      const submitted = await this.client.submit(input)
      observeEvent(this.observability, 'fnf.react.generation_run.submitted', {
        generation_count: submitted.generations.length,
        failed_count: submitted.failed?.length ?? 0,
      })
      if (run.signal.aborted) {
        // Two cases share this signal: superseded by a newer start() (it owns
        // the state) and a plain abort() (nobody else will ever write — land
        // the machine ourselves or `submitting` sticks forever). The submit
        // DID happen: the created generations go into state too, so the UI
        // keeps a handle on them (to show, to `client.cancel`) even though
        // the documented hook pattern discards `start()`'s promise.
        if (run === this.active) {
          this._generations = submitted.generations
          this._failed = submitted.failed ?? []
          this._warning = submitted.warning
          this._status = 'aborted'
          observeEvent(this.observability, 'fnf.react.generation_run.aborted', {
            generation_count: submitted.generations.length,
          })
          this.commit()
        }
        return submitted.generations
      }
      this._generations = submitted.generations
      this._failed = submitted.failed ?? []
      this._warning = submitted.warning
      this._status = 'generating'
      this.commit()

      const done = await this.client.wait(submitted.generations, {
        signal: run.signal,
        onProgress: g => this.upsert(run, g),
      })
      if (run !== this.active)
        return done // superseded while settling — the newer run owns the state
      this._generations = done
      this._status = 'completed'
      observeEvent(this.observability, 'fnf.react.generation_run.completed', {
        generation_count: done.length,
      })
      this.commit()
      return done
    }
    catch (err) {
      if (run !== this.active)
        return [] // a newer start() owns the state now
      if (err instanceof ApiJobError && (err.code === 'aborted' || err.code === 'confirmation_rejected')) {
        this._status = 'aborted'
        observeEvent(this.observability, 'fnf.react.generation_run.aborted', {
          generation_count: this._generations.length,
        })
      }
      else {
        this._error = err instanceof ApiJobError ? err : new ApiJobError('unexpected', err instanceof Error ? err.message : String(err))
        this._status = 'failed'
        observeEvent(this.observability, 'fnf.react.generation_run.failed', {
          generation_count: this._generations.length,
          error_code: this._error.code,
          ...(this._error.status !== undefined ? { error_status: this._error.status } : {}),
        })
      }
      this.commit()
      return this._generations
    }
  }

  /** Stop polling (the backend job keeps running — see `client.cancel`). */
  abort(): void {
    this.active?.abort()
  }

  /** Abort if running and return to `idle` with empty state. */
  reset(): void {
    this.active?.abort()
    this.active = null
    this._status = 'idle'
    this._generations = []
    this._failed = []
    this._warning = undefined
    this._error = undefined
    observeEvent(this.observability, 'fnf.react.generation_run.reset')
    this.commit()
  }

  private upsert(run: AbortController, g: Generation): void {
    if (run !== this.active)
      return
    const at = this._generations.findIndex(existing => existing.id === g.id)
    this._generations = at >= 0
      ? [...this._generations.slice(0, at), g, ...this._generations.slice(at + 1)]
      : [...this._generations, g]
    observeEvent(this.observability, 'fnf.react.generation_run.progress', generationAttributes(g))
    this.commit()
  }
}

function inputAttributes(input: unknown): Record<string, string | number | boolean | null> {
  if (typeof input !== 'object' || input === null)
    return {}
  const record = input as { model?: unknown, count?: unknown }
  return {
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
    ...(typeof record.count === 'number' ? { count: record.count } : {}),
  }
}

function generationAttributes(g: Generation): Record<string, string | number | boolean | null> {
  return {
    generation_id: g.id,
    model: g.model,
    type: g.type,
    status: g.status,
    ...(g.jobSetId ? { job_set_id: g.jobSetId } : {}),
  }
}
