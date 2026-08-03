import type { ReferenceBackend } from '../../backend'
import { describe, expect, it, vi } from 'vitest'
import { createReferenceClient } from '../client'
import { parseReference } from '../codec'

function adapter(overrides: Partial<ReferenceBackend> = {}): ReferenceBackend {
  return {
    getReferenceElement: vi.fn(),
    listReferenceElements: vi.fn(async () => ({ items: [], next_cursor: null })),
    ...overrides,
  }
}

const characterElementBody = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ada',
  category: 'character',
  status: 'completed',
  description: 'Consistent character',
  medias: [{
    id: '22222222-2222-4222-8222-222222222222',
    type: 'media_input',
    url: 'https://cdn.example/ada.webp',
  }],
  video_medias: [],
  character_id: '33333333-3333-4333-8333-333333333333',
  created_at: 123,
}

describe('Elements reference workflow', () => {
  it('maps a Character Element and exposes the Soul character id', () => {
    expect(parseReference(characterElementBody)).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ada',
      category: 'character',
      status: 'completed',
      description: 'Consistent character',
      medias: [{
        id: '22222222-2222-4222-8222-222222222222',
        type: 'media_input',
        url: 'https://cdn.example/ada.webp',
      }],
      videoMedias: [],
      characterId: '33333333-3333-4333-8333-333333333333',
      createdAt: 123,
    })
  })

  it('reads one Element instead of a custom-reference record', async () => {
    const backend = adapter({ getReferenceElement: vi.fn(async () => characterElementBody) })
    const client = createReferenceClient({ adapter: backend })

    await expect(client.get(characterElementBody.id)).resolves.toMatchObject({
      id: characterElementBody.id,
      characterId: characterElementBody.character_id,
    })
    expect(backend.getReferenceElement).toHaveBeenCalledWith(characterElementBody.id)
  })

  it('polls one processing Element until it completes', async () => {
    const statuses = ['processing', 'completed']
    const backend = adapter({
      getReferenceElement: vi.fn(async () => ({
        ...characterElementBody,
        status: statuses.shift(),
      })),
    })
    const client = createReferenceClient({ adapter: backend, scheduler: { sleep: async () => {} } })
    const completed = await client.wait({
      id: characterElementBody.id,
      name: 'Ada',
      category: 'character',
      status: 'processing',
      description: null,
      medias: [],
      videoMedias: [],
    })

    expect(completed.status).toBe('completed')
    expect(backend.getReferenceElement).toHaveBeenCalledTimes(2)
  })

  it('lists only Character Elements when requested', async () => {
    const backend = adapter({
      listReferenceElements: vi.fn(async () => ({
        items: [characterElementBody],
        next_cursor: 123.5,
      })),
    })
    const client = createReferenceClient({ adapter: backend })

    await expect(client.list({ category: 'character', size: 20 })).resolves.toMatchObject({
      items: [{ id: characterElementBody.id, category: 'character' }],
      nextCursor: 123.5,
    })
    expect(backend.listReferenceElements).toHaveBeenCalledWith({ category: 'character', size: 20 })
  })
})
