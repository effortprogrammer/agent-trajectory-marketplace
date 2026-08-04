import { field, group } from '../group'

export const promptCodec = group({
  instruction: field('prompt'),
  enhance: field('enhance_prompt'),
  negative: field('negative_prompt'),
  system: field('system_prompt'),
})
