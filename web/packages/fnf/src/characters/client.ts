import type { CharacterBackend } from '../backend'
import type { FnfObservabilityOptions } from '../observability'
import type { Character, CharacterWaitOptions, CreateCharacterInput } from './types'
import { ApiJobError, JobAbortedError, JobTimeoutError } from '../errors'
import { createObservabilityContext, observeAsync } from '../observability'
import { buildCharacterCreateRequest, parseCharacter } from './codec'

export interface CharacterClientConfig {
  adapter: CharacterBackend
  poll?: { intervalMs?: number, timeoutMs?: number }
  scheduler?: { sleep?: (milliseconds: number) => Promise<void> }
  observability?: FnfObservabilityOptions
}

export interface CharacterClient {
  /** Trains a supported custom-reference character. The backend immediately creates its processing Character Element. */
  create: (input: CreateCharacterInput) => Promise<Character>
  get: (id: string) => Promise<Character>
  wait: (character: Character, options?: CharacterWaitOptions) => Promise<Character>
}

const DEFAULT_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 600_000

export function createCharacterClient(config: CharacterClientConfig): CharacterClient {
  const observability = createObservabilityContext(config.observability)
  const intervalMs = config.poll?.intervalMs ?? DEFAULT_INTERVAL_MS
  const timeoutMs = config.poll?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = config.scheduler?.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))

  const get = (id: string): Promise<Character> => observeAsync(
    observability,
    'fnf.character.get',
    { character_id: id },
    async () => {
      if (!config.adapter.getCharacter)
        throw new ApiJobError('not_supported', 'Character reads are not supported by this adapter')
      return parseCharacter(await config.adapter.getCharacter(id))
    },
    { successAttributes: character => ({ character_id: character.id, status: character.status }) },
  )

  return {
    create: input => observeAsync(observability, 'fnf.character.create', {}, async () => {
      if (!config.adapter.createCharacter)
        throw new ApiJobError('not_supported', 'Character creation is not supported by this adapter')
      return parseCharacter(await config.adapter.createCharacter(buildCharacterCreateRequest(input)))
    }, { successAttributes: character => ({ character_id: character.id, status: character.status }) }),
    get,
    wait: async (character, options = {}) => {
      if (character.status === 'completed' || character.status === 'failed')
        return character
      const startedAt = Date.now()
      const waitIntervalMs = options.intervalMs ?? intervalMs
      const waitTimeoutMs = options.timeoutMs ?? timeoutMs
      let current = character
      while (Date.now() - startedAt < waitTimeoutMs) {
        if (options.signal?.aborted)
          throw new JobAbortedError()
        await sleep(waitIntervalMs)
        if (options.signal?.aborted)
          throw new JobAbortedError()
        current = await get(character.id)
        options.onProgress?.(current)
        if (current.status === 'completed' || current.status === 'failed')
          return current
      }
      throw new JobTimeoutError(character.id, waitTimeoutMs)
    },
  }
}
