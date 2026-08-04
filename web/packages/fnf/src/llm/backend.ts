/**
 * LLM port (spec §5.1): the transport-agnostic surface template apps consume.
 * Wire shape is the gateway's OpenAI-compatible subset; these types stay
 * deliberately narrower than openai's own (YAGNI: only what the gateway accepts).
 */

export interface LlmMessagePart { type: 'text' | 'image_url', text?: string, image_url?: { url: string } }
export interface LlmToolCall { id: string, name: string, arguments: string }
export interface LlmToolCallDelta { index: number, id?: string, name?: string, argumentsDelta?: string }
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | LlmMessagePart[]
  tool_call_id?: string
  tool_calls?: LlmToolCall[]
}
export interface LlmToolDef {
  name: string
  description?: string
  parameters: Record<string, unknown> // JSON Schema
}
export interface LlmCompleteRequest {
  model: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  tools?: LlmToolDef[]
  toolChoice?: 'auto' | 'none' | { name: string }
  signal?: AbortSignal
}
export interface LlmUsage { promptTokens: number, completionTokens: number }
export interface LlmCompletion {
  content: string
  toolCalls: LlmToolCall[]
  finishReason: string
  usage: LlmUsage
}
export interface LlmDelta {
  content?: string
  toolCallDelta?: LlmToolCallDelta
  finishReason?: string
  usage?: LlmUsage
}

export interface LlmBackend {
  complete: (req: LlmCompleteRequest) => Promise<LlmCompletion>
  stream: (req: LlmCompleteRequest) => AsyncIterable<LlmDelta>
  listModels: () => Promise<string[]>
}
