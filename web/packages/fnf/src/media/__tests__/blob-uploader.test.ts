import { describe, expect, it } from 'vitest'
import { JobAbortedError } from '../../errors'
import { createFetchUploader } from '../blob-uploader'
import { UploadTransferError, UrlIngestError } from '../errors'

type FetchLike = typeof globalThis.fetch

function uploader(fetch: FetchLike, retries = 2) {
  return createFetchUploader({ fetch, retries })
}

const PUT = { uploadUrl: 'https://s3/put/m1', bytes: new Uint8Array([1]), contentType: 'image/png' }

describe('createFetchUploader.transfer', () => {
  it('retries 5xx then succeeds', async () => {
    let calls = 0
    const up = uploader(async () => new Response('', { status: ++calls < 2 ? 503 : 200 }))
    await up.transfer(PUT)
    expect(calls).toBe(2)
  })

  it('bails on 4xx with the status (no retry)', async () => {
    let calls = 0
    const up = uploader(async () => {
      calls++
      return new Response('denied', { status: 403 })
    })
    await expect(up.transfer(PUT)).rejects.toMatchObject({ code: 'upload_failed', status: 403 })
    expect(calls).toBe(1)
  })

  it('an abort mid-PUT throws JobAbortedError without burning the retry budget', async () => {
    const controller = new AbortController()
    let calls = 0
    const up = uploader(async () => {
      calls++
      controller.abort() // abort lands while the PUT is in flight
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    await expect(up.transfer({ ...PUT, signal: controller.signal })).rejects.toBeInstanceOf(JobAbortedError)
    expect(calls).toBe(1) // not retried with the aborted signal
  })

  it('a pre-aborted signal throws before any request', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const up = uploader(async () => {
      calls++
      return new Response('', { status: 200 })
    })
    await expect(up.transfer({ ...PUT, signal: controller.signal })).rejects.toBeInstanceOf(JobAbortedError)
    expect(calls).toBe(0)
  })

  it('exhausted network retries surface the last cause in the message', async () => {
    const up = uploader(async () => {
      throw new TypeError('Failed to fetch')
    }, 1)
    await expect(up.transfer(PUT)).rejects.toThrow(/after 2 attempts: Failed to fetch/)
  })
})

describe('createFetchUploader.fetchBytes', () => {
  it('returns bytes + content type', async () => {
    const up = uploader(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }))
    const out = await up.fetchBytes!('https://x/a.png')
    expect(out.contentType).toBe('image/png')
    expect((out.bytes as Uint8Array).length).toBe(3)
  })

  it('rejects early via content-length and late via byteLength when over maxBytes', async () => {
    const declared = uploader(async () => new Response('', { status: 200, headers: { 'content-length': '10' } }))
    await expect(declared.fetchBytes!('https://x/a', { maxBytes: 5 })).rejects.toBeInstanceOf(UrlIngestError)

    const undeclared = uploader(async () => new Response(new Uint8Array(10), { status: 200 }))
    await expect(undeclared.fetchBytes!('https://x/a', { maxBytes: 5 })).rejects.toBeInstanceOf(UrlIngestError)
  })

  it('an abort during the download throws JobAbortedError, not UrlIngestError', async () => {
    const controller = new AbortController()
    const up = uploader(async () => {
      controller.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    await expect(up.fetchBytes!('https://x/a', { signal: controller.signal })).rejects.toBeInstanceOf(JobAbortedError)
  })

  it('a non-OK response throws UploadTransferError-free UrlIngestError with the status', async () => {
    const up = uploader(async () => new Response('', { status: 404 }))
    await expect(up.fetchBytes!('https://x/a')).rejects.toThrow(/404/)
    await expect(up.fetchBytes!('https://x/a')).rejects.toBeInstanceOf(UrlIngestError)
    expect(UploadTransferError.is(await up.fetchBytes!('https://x/a').catch(e => e))).toBe(false)
  })
})
