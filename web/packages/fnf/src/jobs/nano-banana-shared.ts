import type { GenerationInput } from '../types'
import { closestRatioBySize, firstSizeMeta, lookupSize } from './dimensions'

export const NanoBananaAspectRatio = {
  auto: 'auto',
  r1x1: '1:1',
  r3x2: '3:2',
  r2x3: '2:3',
  r4x3: '4:3',
  r3x4: '3:4',
  r4x5: '4:5',
  r5x4: '5:4',
  r9x16: '9:16',
  r16x9: '16:9',
  r21x9: '21:9',
} as const

export type NanoBananaAspectRatioValue = typeof NanoBananaAspectRatio[keyof typeof NanoBananaAspectRatio]
export type NanoBananaConcreteRatio = Exclude<NanoBananaAspectRatioValue, 'auto'>
export type NanoBananaResolution = '1k' | '2k' | '4k'

export const NANO_BANANA_ASPECT_RATIO_VALUES = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'] as const

// Iteration order mirrors fnf-web's getNanoBanana2ClosestAspectRatio.
export const NANO_BANANA_CONCRETE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const

export const NANO_BANANA_SIZE_MAP: Record<NanoBananaResolution, Record<NanoBananaConcreteRatio, [number, number]>> = {
  '1k': { '1:1': [1024, 1024], '2:3': [848, 1264], '3:2': [1264, 848], '3:4': [896, 1200], '4:3': [1200, 896], '4:5': [928, 1152], '5:4': [1152, 928], '9:16': [768, 1376], '16:9': [1376, 768], '21:9': [1584, 672] },
  '2k': { '1:1': [2048, 2048], '2:3': [1696, 2528], '3:2': [2528, 1696], '3:4': [1792, 2400], '4:3': [2400, 1792], '4:5': [1856, 2304], '5:4': [2304, 1856], '9:16': [1536, 2752], '16:9': [2752, 1536], '21:9': [3168, 1344] },
  '4k': { '1:1': [4096, 4096], '2:3': [3392, 5056], '3:2': [5056, 3392], '3:4': [3584, 4800], '4:3': [4800, 3584], '4:5': [3712, 4608], '5:4': [4608, 3712], '9:16': [3072, 5504], '16:9': [5504, 3072], '21:9': [6336, 2688] },
}

export function resolveNanoBananaRatio(input: GenerationInput, roles: readonly string[], ratio: NanoBananaAspectRatioValue): NanoBananaConcreteRatio {
  if (ratio !== 'auto')
    return ratio
  const size = firstSizeMeta(input.media, roles)
  return size ? closestRatioBySize(NANO_BANANA_CONCRETE_RATIOS, size) : '3:4'
}

export function getNanoBananaDimensions(resolution: NanoBananaResolution, ratio: NanoBananaConcreteRatio): { width: number, height: number } {
  return lookupSize(NANO_BANANA_SIZE_MAP, resolution, ratio)
}
