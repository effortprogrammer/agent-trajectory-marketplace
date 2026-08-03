import type { CostEstimate, GenerationInput } from '@higgsfield/fnf/client'
import type { FnfScopeOptions } from './keys'
import { queryOptions } from '@tanstack/react-query'
import { fnfKeys } from './keys'

export interface CostQueryClient<Input = GenerationInput> {
  cost: (input: Input) => Promise<CostEstimate>
}

export interface CostQueryOptions extends FnfScopeOptions {
  enabled?: boolean
}

export function costQueryOptions<Input>(client: CostQueryClient<Input>, input: Input, opts?: CostQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.cost(input, opts),
    queryFn: () => client.cost(input),
    enabled: opts?.enabled,
  })
}
