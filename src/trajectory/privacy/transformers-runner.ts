import {
  type PiiCategory,
  type PrivacyFilter,
  PrivacyFilterUnavailableError,
  type PrivacySpan,
  piiCategories,
} from "./contract"

// Production PrivacyFilter backed by Transformers.js running the
// openai/privacy-filter token classifier in-process. The model is loaded
// lazily and cached per model id so the resident collect-watch loop pays the
// load once per process, not per sweep.
//
// The token-classification *pipeline* is deliberately not used: under
// Transformers.js it returns no character offsets, and masking needs exact
// spans. Instead the tokenizer and model run directly, and each token's
// offset is reconstructed by decoding its id and greedy-matching the piece
// against the source text — verified exact for this model's byte-level
// tokenizer (see scripts/privacy-filter-smoke.ts).

// The model's BIOES label vocabulary, normalized to our canonical slugs.
const categoryAliases: Readonly<Record<string, PiiCategory>> = {
  account_number: "account_number",
  private_address: "address",
  private_date: "date",
  private_email: "email",
  private_person: "person_name",
  private_phone: "phone_number",
  private_url: "url",
  secret: "secret",
}

const normalizeCategory = (label: string): PiiCategory | undefined => {
  const stripped = label.replace(/^[BIES]-/i, "").toLowerCase()
  if ((piiCategories as readonly string[]).includes(stripped)) {
    return stripped as PiiCategory
  }
  return categoryAliases[stripped]
}

type ModelToken = Readonly<{
  entity: string
  score: number
  start?: number | null
  end?: number | null
}>

const isUsableToken = (
  token: ModelToken,
): token is ModelToken & Readonly<{ start: number; end: number }> =>
  typeof token.start === "number" &&
  typeof token.end === "number" &&
  token.start >= 0 &&
  token.end > token.start

// Folds BIOES token labels into contiguous spans: consecutive same-category
// tokens with no more than one character of gap merge into one span whose
// score is the mean of its tokens. B-/S- tags always open a new span.
export const tokensToSpans = (tokens: readonly ModelToken[]): readonly PrivacySpan[] => {
  const spans: Array<{ start: number; end: number; category: PiiCategory; scores: number[] }> = []
  for (const token of tokens) {
    if (!isUsableToken(token)) {
      continue
    }
    const category = normalizeCategory(token.entity)
    if (category === undefined) {
      continue
    }
    const previous = spans[spans.length - 1]
    const continues =
      previous !== undefined &&
      previous.category === category &&
      token.start <= previous.end + 1 &&
      !/^[BS]-/i.test(token.entity)
    if (continues) {
      previous.end = Math.max(previous.end, token.end)
      previous.scores.push(token.score)
      continue
    }
    spans.push({ start: token.start, end: token.end, category, scores: [token.score] })
  }
  return spans.map((span) => ({
    start: span.start,
    end: span.end,
    category: span.category,
    score: span.scores.reduce((sum, score) => sum + score, 0) / span.scores.length,
  }))
}

// Token pieces carry their leading whitespace ("... Jane"); shrink each span
// to its visible content so masking does not eat separators.
const trimSpansToContent = (text: string, spans: readonly PrivacySpan[]): readonly PrivacySpan[] =>
  spans
    .map((span) => {
      let start = span.start
      let end = span.end
      while (start < end && /\s/.test(text[start] ?? "")) {
        start += 1
      }
      while (end > start && /\s/.test(text[end - 1] ?? "")) {
        end -= 1
      }
      return { ...span, start, end }
    })
    .filter((span) => span.start < span.end)

type LoadedModel = Readonly<{
  tokenizer: (text: string) => {
    input_ids: { tolist: () => (number | bigint)[][] }
    attention_mask: unknown
  }
  decodeTokens: (ids: readonly number[]) => string
  run: (
    encoding: object,
  ) => Promise<{ logits: { dims: readonly number[]; data: ArrayLike<number> } }>
  id2label: Readonly<Record<string, string>>
}>

const modelCache = new Map<string, Promise<LoadedModel>>()

const loadModel = (modelId: string): Promise<LoadedModel> => {
  const cached = modelCache.get(modelId)
  if (cached !== undefined) {
    return cached
  }
  const loading = (async (): Promise<LoadedModel> => {
    // Dynamic import keeps the heavyweight ONNX runtime out of every CLI
    // invocation that never touches the privacy pass.
    const transformers = await import("@huggingface/transformers")
    const [tokenizer, model, config] = await Promise.all([
      transformers.AutoTokenizer.from_pretrained(modelId),
      transformers.AutoModelForTokenClassification.from_pretrained(modelId),
      transformers.AutoConfig.from_pretrained(modelId),
    ])
    const id2label = (config as unknown as { id2label?: Record<string, string> }).id2label
    if (id2label === undefined) {
      throw new Error(`model config for ${modelId} has no id2label`)
    }
    return {
      tokenizer: (text: string) =>
        tokenizer(text) as unknown as ReturnType<LoadedModel["tokenizer"]>,
      decodeTokens: (ids: readonly number[]) =>
        tokenizer.decode([...ids], { skip_special_tokens: false }),
      run: (encoding: object) =>
        (model as unknown as (input: object) => Promise<{ logits: never }>)(encoding),
      id2label,
    }
  })()
  // A failed load must not poison the cache; the next sweep retries.
  loading.catch(() => modelCache.delete(modelId))
  modelCache.set(modelId, loading)
  return loading
}

const softmaxScore = (logits: ArrayLike<number>, offset: number, classCount: number) => {
  let bestIndex = 0
  let bestLogit = Number.NEGATIVE_INFINITY
  for (let index = 0; index < classCount; index += 1) {
    const logit = Number(logits[offset + index])
    if (logit > bestLogit) {
      bestLogit = logit
      bestIndex = index
    }
  }
  let sum = 0
  for (let index = 0; index < classCount; index += 1) {
    sum += Math.exp(Number(logits[offset + index]) - bestLogit)
  }
  return { bestIndex, score: 1 / sum }
}

const replacementChar = "�"
// A UTF-8 char spans at most 4 bytes/tokens, but one token can also carry the
// tail of one char plus the head of the next, chaining fragments; 32 bounds
// pathological runs while covering realistic multibyte sequences.
const maxGroupTokens = 32

const detectInText = async (loaded: LoadedModel, text: string): Promise<readonly PrivacySpan[]> => {
  const encoding = loaded.tokenizer(text)
  const ids = encoding.input_ids.tolist()[0] ?? []
  const { logits } = await loaded.run(encoding)
  const [, sequenceLength, classCount] = logits.dims
  if (sequenceLength === undefined || classCount === undefined) {
    throw new Error(`unexpected logits shape: ${JSON.stringify(logits.dims)}`)
  }

  const positionCount = Math.min(ids.length, sequenceLength)
  const labels: { label: string; score: number }[] = []
  for (let position = 0; position < positionCount; position += 1) {
    const { bestIndex, score } = softmaxScore(logits.data, position * classCount, classCount)
    labels.push({ label: loaded.id2label[String(bestIndex)] ?? "O", score })
  }

  // Byte-level BPE can split one UTF-8 character across tokens; a fragment
  // decodes to U+FFFD alone but decodes cleanly once joined with its
  // neighbors. Tokens therefore accumulate into a group until the group
  // decodes without replacement characters, and the group is located as one
  // piece; every PII-labeled token in the group is attributed the group's
  // span (slight over-masking, never under-masking).
  const tokens: ModelToken[] = []
  let cursor = 0
  let groupIds: number[] = []
  let groupPositions: number[] = []

  const groupHasPii = () =>
    groupPositions.some((position) => {
      const label = labels[position]?.label ?? "O"
      return label !== "O" && normalizeCategory(label) !== undefined
    })

  const locateGroup = (piece: string): boolean => {
    const at = text.indexOf(piece, cursor)
    if (at === -1) {
      return false
    }
    cursor = at + piece.length
    for (const position of groupPositions) {
      const { label, score } = labels[position] ?? { label: "O", score: 0 }
      if (label === "O") {
        continue
      }
      tokens.push({ entity: label, score, start: at, end: at + piece.length })
    }
    groupIds = []
    groupPositions = []
    return true
  }

  for (let position = 0; position < positionCount; position += 1) {
    groupIds.push(Number(ids[position]))
    groupPositions.push(position)
    const piece = loaded.decodeTokens(groupIds)
    if (piece.length === 0) {
      // Pure special tokens decode to nothing and carry no text to locate.
      groupIds = []
      groupPositions = []
      continue
    }
    if (piece.includes(replacementChar) && groupIds.length < maxGroupTokens) {
      continue
    }
    if (!locateGroup(piece)) {
      // Offset reconstruction lost sync even after grouping (pathological
      // input). If the unlocatable group carries a PII label, fail closed
      // for this text: the caller masks what it cannot place.
      if (groupHasPii()) {
        return [{ start: 0, end: text.length, category: "secret", score: 1 }]
      }
      groupIds = []
      groupPositions = []
    }
  }
  // A trailing group can end dirty when the text itself ends mid-sequence.
  if (groupIds.length > 0) {
    const piece = loaded.decodeTokens(groupIds)
    if (piece.length > 0 && !locateGroup(piece) && groupHasPii()) {
      return [{ start: 0, end: text.length, category: "secret", score: 1 }]
    }
  }
  return trimSpansToContent(text, tokensToSpans(tokens))
}

export const createTransformersPrivacyFilter = (modelId: string): PrivacyFilter => ({
  detect: async (texts) => {
    let loaded: LoadedModel
    try {
      loaded = await loadModel(modelId)
    } catch (caught: unknown) {
      throw new PrivacyFilterUnavailableError(`privacy filter model failed to load: ${modelId}`, {
        cause: caught,
      })
    }
    const results: (readonly PrivacySpan[])[] = []
    for (const text of texts) {
      if (text.length === 0) {
        results.push([])
        continue
      }
      try {
        results.push(await detectInText(loaded, text))
      } catch (caught: unknown) {
        throw new PrivacyFilterUnavailableError(`privacy filter inference failed: ${modelId}`, {
          cause: caught,
        })
      }
    }
    return results
  },
})
