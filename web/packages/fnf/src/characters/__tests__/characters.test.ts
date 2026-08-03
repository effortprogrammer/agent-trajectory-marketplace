import type { CharacterBackend } from '../../backend'
import type { MediaRef } from '../../types'
import { describe, expect, it, vi } from 'vitest'
import { createCharacterClient } from '../client'
import { buildCharacterCreateRequest, parseCharacter } from '../codec'

function image(index: number): MediaRef {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    type: 'media_input',
    url: `https://private.example/${index}.jpg`,
  }
}

function jobImage(index: number): MediaRef {
  return {
    id: `00000000-0000-4000-8001-${String(index).padStart(12, '0')}`,
    type: 'image_job',
  }
}

function adapter(overrides: Partial<CharacterBackend> = {}): CharacterBackend {
  return {
    createCharacter: vi.fn(async req => ({
      id: '11111111-1111-4111-8111-111111111111',
      type: req.type,
      status: 'queued',
      name: 'Ada',
    })),
    getCharacter: vi.fn(),
    ...overrides,
  }
}

const input = {
  name: ' Ada ',
  images: Array.from({ length: 5 }, (_, index) => image(index + 1)),
}

describe('custom-reference character training workflow', () => {
  it('defaults to Soul 2 and removes media URLs from the wire request', () => {
    expect(buildCharacterCreateRequest(input)).toEqual({
      name: 'Ada',
      type: 'soul_2',
      input_images: input.images.map(({ id }) => ({ id, type: 'media_input' })),
    })
  })

  it.each(['soul', 'soul_2', 'soul_cinematic'] as const)('supports the %s custom-reference type', (type) => {
    expect(buildCharacterCreateRequest({ ...input, type })).toMatchObject({ type })
  })

  it.each(['soul_2', 'soul_cinematic'] as const)('preserves job image references for %s', (type) => {
    const images = [jobImage(1)]
    expect(buildCharacterCreateRequest({ type, images })).toEqual({
      name: 'Untitled character',
      type,
      input_images: images.map(({ id }) => ({ id, type: 'image_job' })),
    })
  })

  it('uses a sensible default name', () => {
    expect(buildCharacterCreateRequest({ images: input.images })).toMatchObject({
      name: 'Untitled character',
    })
  })

  it('creates a character and parses its custom-reference lifecycle record', async () => {
    const backend = adapter()
    const client = createCharacterClient({ adapter: backend })

    await expect(client.create(input)).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ada',
      type: 'soul_2',
      status: 'queued',
    })
    expect(backend.createCharacter).toHaveBeenCalledWith(buildCharacterCreateRequest(input))
  })

  it('maps the linked Element id when the backend provides it', () => {
    expect(parseCharacter({
      id: '11111111-1111-4111-8111-111111111111',
      element_id: '22222222-2222-4222-8222-222222222222',
      type: 'soul_cinematic',
      status: 'completed',
    })).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      elementId: '22222222-2222-4222-8222-222222222222',
      type: 'soul_cinematic',
      status: 'completed',
    })
  })

  it('polls the character training record until it completes', async () => {
    const statuses = ['in_progress', 'completed']
    const backend = adapter({
      getCharacter: vi.fn(async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        type: 'soul_2',
        status: statuses.shift(),
      })),
    })
    const client = createCharacterClient({ adapter: backend, scheduler: { sleep: async () => {} } })
    const completed = await client.wait({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'soul_2',
      status: 'queued',
    })

    expect(completed.status).toBe('completed')
    expect(backend.getCharacter).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no images', []],
    ['more than one hundred', Array.from({ length: 101 }, (_, index) => image(index))],
    ['a non-image media reference', [{ id: 'video-1', type: 'video_input' }]],
  ])('rejects %s before any request', async (_label, images) => {
    const backend = adapter()
    const client = createCharacterClient({ adapter: backend })

    await expect(client.create({ images })).rejects.toMatchObject({ code: 'validation' })
    expect(backend.createCharacter).not.toHaveBeenCalled()
  })

  it('rejects job image references for the original Soul type', async () => {
    const backend = adapter()
    const client = createCharacterClient({ adapter: backend })

    await expect(client.create({ type: 'soul', images: [jobImage(1)] }))
      .rejects.toMatchObject({ code: 'validation' })
    expect(backend.createCharacter).not.toHaveBeenCalled()
  })

  it('rejects a name longer than one hundred characters before any request', async () => {
    const backend = adapter()
    const client = createCharacterClient({ adapter: backend })

    await expect(client.create({ name: 'a'.repeat(101), images: input.images }))
      .rejects.toMatchObject({ code: 'validation' })
    expect(backend.createCharacter).not.toHaveBeenCalled()
  })
})
