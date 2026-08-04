import type { UploadInput, UploadResult } from '@higgsfield/fnf/media'
import type { FnfObservationEvent } from '@higgsfield/fnf/observability'
import { describe, expect, it } from 'vitest'
import { AttachmentsController } from '../attachments'

function fakeMedia(respond?: (input: UploadInput) => Partial<UploadResult> | Error) {
  const uploads: UploadInput[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => (release = resolve))
  const media = {
    async upload(input: UploadInput): Promise<UploadResult> {
      uploads.push(input)
      await gate
      const out = respond?.(input)
      if (out instanceof Error)
        throw out
      return {
        ref: { id: `m${uploads.length}`, type: 'media_input', url: `https://cdn/m${uploads.length}.png`, ...(input.role ? { role: input.role } : {}) },
        mediaId: `m${uploads.length}`,
        status: 'uploaded',
        type: 'image',
        contentType: 'image/png',
        filename: String(input.filename ?? 'x.png'),
        ...out,
      }
    },
  }
  return { media, uploads, release: () => release?.() }
}

const file = (name = 'cat.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

describe('AttachmentsController', () => {
  it('files preview immediately, upload in background, and become submit-ready refs', async () => {
    const { media, uploads, release } = fakeMedia()
    const attachments = new AttachmentsController(media, { upload: { forceIpCheck: true }, measure: false })

    const [key] = attachments.add(file(), { role: 'start_image' })
    expect(attachments.items[0]).toMatchObject({ key, status: 'uploading' })
    expect(attachments.isUploading).toBe(true)
    expect(attachments.refs).toEqual([]) // not ready yet

    release()
    const refs = await attachments.settled()

    expect(uploads[0]).toMatchObject({ filename: 'cat.png', role: 'start_image', forceIpCheck: true, throwOnModeration: false })
    expect(refs).toHaveLength(1)
    expect(attachments.items[0]).toMatchObject({ status: 'ready', previewUrl: 'https://cdn/m1.png' })
  })

  it('already-uploaded refs are ready as-is; order is presentational (move)', () => {
    const { media } = fakeMedia()
    const attachments = new AttachmentsController(media)
    attachments.add({ id: 'r1', type: 'media_input', url: 'https://cdn/r1.png' })
    attachments.add({ id: 'r2', type: 'media_input', url: 'https://cdn/r2.png' })

    attachments.move(1, 0)

    expect(attachments.refs.map(r => r.id)).toEqual(['r2', 'r1'])
  })

  it('a moderation verdict becomes a blocked item, not a throw', async () => {
    const { media, release } = fakeMedia(() => ({ status: 'ip_detected', moderation: { status: 'ip_detected' } }))
    const attachments = new AttachmentsController(media, { measure: false })
    attachments.add(file())
    release()

    const refs = await attachments.settled()

    expect(refs).toEqual([]) // blocked items never feed a submit
    expect(attachments.items[0]).toMatchObject({ status: 'blocked', moderation: { status: 'ip_detected' } })
  })

  it('retry keeps the original role and options', async () => {
    let attempts = 0
    const { media, uploads, release } = fakeMedia(() => (attempts++ === 0 ? new Error('boom') : {}))
    const attachments = new AttachmentsController(media, { measure: false })
    const [key] = attachments.add(file(), { role: 'start_image', forceIpCheck: true })
    release()
    await attachments.settled()

    attachments.retry(key)
    await attachments.settled()

    expect(uploads[1]).toMatchObject({ role: 'start_image', forceIpCheck: true }) // not dropped on retry
    expect(attachments.items[0].role).toBe('start_image')
  })

  it('removing an in-flight item aborts its upload signal', async () => {
    let seenSignal: AbortSignal | undefined
    const { media, release } = fakeMedia()
    const wrapped = {
      async upload(input: UploadInput) {
        seenSignal = input.signal
        return media.upload(input)
      },
    }
    const attachments = new AttachmentsController(wrapped, { measure: false })
    const [key] = attachments.add(file())
    attachments.remove(key)
    release()
    await attachments.settled()

    expect(seenSignal?.aborted).toBe(true)
  })

  it('a failed upload carries the typed error and is retryable', async () => {
    let attempts = 0
    const { media, release } = fakeMedia(() => (attempts++ === 0 ? new Error('socket hang up') : {}))
    const attachments = new AttachmentsController(media, { measure: false })
    const [key] = attachments.add(file())
    release()
    await attachments.settled()
    expect(attachments.items[0]).toMatchObject({ status: 'failed', error: { code: 'unexpected', message: 'socket hang up' } })

    attachments.retry(key)
    const refs = await attachments.settled()

    expect(refs).toHaveLength(1)
    expect(attachments.items[0].status).toBe('ready')
  })

  it('removing an item mid-upload drops the late result', async () => {
    const { media, release } = fakeMedia()
    const attachments = new AttachmentsController(media, { measure: false })
    const [key] = attachments.add(file())
    attachments.remove(key)
    release()

    const refs = await attachments.settled()

    expect(refs).toEqual([])
    expect(attachments.items).toEqual([])
  })

  it('emits safe observability events for attachment lifecycle', async () => {
    const events: FnfObservationEvent[] = []
    const { media, release } = fakeMedia()
    const attachments = new AttachmentsController(media, {
      measure: false,
      observability: {
        observer: (event) => {
          events.push(event)
        },
      },
    })

    attachments.add(file('private-cat.png'), { role: 'start_image' })
    release()
    await attachments.settled()
    attachments.clear()

    expect(events.map(event => event.name)).toEqual(expect.arrayContaining([
      'fnf.react.attachments.add',
      'fnf.react.attachments.upload_start',
      'fnf.react.attachments.ready',
      'fnf.react.attachments.settled',
      'fnf.react.attachments.clear',
    ]))
    expect(JSON.stringify(events)).not.toContain('private-cat.png')
    expect(JSON.stringify(events)).not.toContain('https://cdn/')
  })
})

describe('AttachmentsController — the measure path (default on)', () => {
  /** Stub the structural DOM the SDK resolver probes; `loads` scripts the attempts. */
  function stubDom(loads: boolean[]) {
    const attempts = { count: 0 }
    class FakeImage {
      naturalWidth = 800
      naturalHeight = 600
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      #src = ''

      get src() {
        return this.#src
      }

      set src(value: string) {
        this.#src = value
        const ok = loads[Math.min(attempts.count++, loads.length - 1)]
        queueMicrotask(() => (ok ? this.onload?.() : this.onerror?.()))
      }
    }
    ;(globalThis as Record<string, unknown>).Image = FakeImage
    ;(globalThis as Record<string, unknown>).document = { createElement: () => ({}) }
    return {
      attempts,
      restore: () => {
        delete (globalThis as Record<string, unknown>).Image
        delete (globalThis as Record<string, unknown>).document
      },
    }
  }

  it('measured intrinsic size lands on the submit-ready ref', async () => {
    const dom = stubDom([true])
    try {
      const { media, release } = fakeMedia()
      const attachments = new AttachmentsController(media)
      attachments.add(file())
      release()

      const refs = await attachments.settled()

      expect(refs[0].meta).toEqual({ width: 800, height: 600 })
    }
    finally {
      dom.restore()
    }
  })

  it('a failed measurement NEVER fails a successful upload — ready, just without meta', async () => {
    const dom = stubDom([false]) // e.g. a PDF mislabeled as image, a broken codec
    try {
      const { media, release } = fakeMedia()
      const attachments = new AttachmentsController(media)
      attachments.add(file())
      release()

      const refs = await attachments.settled()

      expect(attachments.items[0].status).toBe('ready')
      expect(refs).toHaveLength(1)
      expect(refs[0].meta).toBeUndefined()
    }
    finally {
      dom.restore()
    }
  })

  it('retry after a failed upload re-measures instead of replaying a cached failure', async () => {
    const dom = stubDom([false, true])
    try {
      let uploadAttempts = 0
      const { media, release } = fakeMedia(() => (uploadAttempts++ === 0 ? new Error('boom') : {}))
      const attachments = new AttachmentsController(media)
      const [key] = attachments.add(file())
      release()
      await attachments.settled()
      expect(attachments.items[0].status).toBe('failed')

      attachments.retry(key)
      const refs = await attachments.settled()

      expect(attachments.items[0].status).toBe('ready')
      expect(refs[0].meta).toEqual({ width: 800, height: 600 }) // the second measurement, not the poisoned first
    }
    finally {
      dom.restore()
    }
  })
})
