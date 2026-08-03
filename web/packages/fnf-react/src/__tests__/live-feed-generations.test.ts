import type { Generation } from '@higgsfield/fnf/client'
import { describe, expect, it } from 'vitest'
import { liveFeedPollTargets } from '../live-feed-generations-hook'

function gen(id: string, status: Generation['status']): Generation {
  return { id, model: 'demo', type: 'image', status, input: { model: 'demo', settings: {} } }
}

describe('liveFeedPollTargets', () => {
  it('keeps one snapshot per non-terminal id and skips terminal generations', () => {
    const targets = liveFeedPollTargets([
      gen('a', 'queued'),
      gen('b', 'completed'),
      gen('a', 'in_progress'),
      gen('c', 'failed'),
    ])

    expect(targets).toEqual([gen('a', 'in_progress')])
  })

  it('does not reopen a terminal duplicate from a stale pending snapshot', () => {
    expect(liveFeedPollTargets([
      gen('a', 'completed'),
      gen('a', 'in_progress'),
    ])).toEqual([])
  })

  it('bounds restored polling and advances through the feed as earlier targets settle', () => {
    const restored = Array.from({ length: 25 }, (_, index) => gen(`job-${index}`, 'queued'))

    expect(liveFeedPollTargets(restored).map(generation => generation.id))
      .toEqual(Array.from({ length: 20 }, (_, index) => `job-${index}`))

    const afterHeadSettles = [gen('job-0', 'completed'), ...restored.slice(1)]
    expect(liveFeedPollTargets(afterHeadSettles).map(generation => generation.id))
      .toEqual(Array.from({ length: 20 }, (_, index) => `job-${index + 1}`))
  })
})
