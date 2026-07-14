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
  makeTensor: (data: BigInt64Array, dims: readonly number[]) => object
  padTokenId: number
  id2label: Readonly<Record<string, string>>
}>

const modelCache = new Map<string, Promise<LoadedModel>>()

// Weight precision to load. q8 is the CPU sweet spot: ~4x smaller than fp32
// with near-identical token-classification output; fp32 stays available for
// accuracy comparisons.
export type PrivacyModelDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16"

const loadModel = (modelId: string, dtype: PrivacyModelDtype): Promise<LoadedModel> => {
  const cacheKey = `${modelId}#${dtype}`
  const cached = modelCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }
  const loading = (async (): Promise<LoadedModel> => {
    // Dynamic import keeps the heavyweight ONNX runtime out of every CLI
    // invocation that never touches the privacy pass.
    const transformers = await import("@huggingface/transformers")
    const [tokenizer, model, config] = await Promise.all([
      transformers.AutoTokenizer.from_pretrained(modelId),
      transformers.AutoModelForTokenClassification.from_pretrained(modelId, {
        dtype: dtype === "fp32" ? "fp32" : dtype,
      }),
      transformers.AutoConfig.from_pretrained(modelId),
    ])
    const id2label = (config as unknown as { id2label?: Record<string, string> }).id2label
    if (id2label === undefined) {
      throw new Error(`model config for ${modelId} has no id2label`)
    }
    const padTokenId = (tokenizer as unknown as { pad_token_id?: number }).pad_token_id ?? 0
    return {
      tokenizer: (text: string) =>
        tokenizer(text) as unknown as ReturnType<LoadedModel["tokenizer"]>,
      decodeTokens: (ids: readonly number[]) =>
        tokenizer.decode([...ids], { skip_special_tokens: false }),
      run: (encoding: object) =>
        (model as unknown as (input: object) => Promise<{ logits: never }>)(encoding),
      makeTensor: (data: BigInt64Array, dims: readonly number[]) =>
        new transformers.Tensor("int64", data, [...dims]),
      // Padded positions are masked out, so the pad id itself never reaches
      // attention; 0 is a safe fallback when the tokenizer defines none.
      padTokenId,
      id2label,
    }
  })()
  // A failed load must not poison the cache; the next sweep retries.
  loading.catch(() => modelCache.delete(cacheKey))
  modelCache.set(cacheKey, loading)
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

type TokenLabel = Readonly<{ label: string; score: number }>

// Derives the spans of one text from its token ids and per-token labels —
// the offset-reconstruction half of detection, shared by the batched and
// single-row inference paths.
const spansFromLabeledTokens = (
  loaded: LoadedModel,
  text: string,
  ids: readonly (number | bigint)[],
  labels: readonly TokenLabel[],
): readonly PrivacySpan[] => {
  const positionCount = Math.min(ids.length, labels.length)

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

export type TransformersPrivacyFilterOptions = Readonly<{
  // Rows per forward pass. 1 disables batching (the A/B reference path).
  maxBatchSize?: number
  // Padded-token budget per batch (rows x padded length): bounds the compute
  // wasted on padding when short and long texts would otherwise mix.
  maxBatchTokens?: number
  dtype?: PrivacyModelDtype
}>

const defaultPrivacyDtype: PrivacyModelDtype = "fp32"
// Benchmarked on a real 800-string session (Apple Silicon, CPU EP): single
// inference already saturates the cores, so batching only pays for the many
// short strings — a small padded-token budget groups those while long leaves
// run alone. 32 rows / 2048 tokens measured 1.84x over sequential with
// byte-identical span output; larger budgets (16k+) regressed below 1x from
// padding waste. q8 weights measured within noise of fp32 here and change
// span boundaries slightly, so fp32 stays the default.
const defaultMaxBatchSize = 32
const defaultMaxBatchTokens = 2048

type EncodedText = Readonly<{ index: number; text: string; ids: readonly (number | bigint)[] }>

// Length-bucketed batching: texts sorted by token count are grouped while
// both the row cap and the padded-token budget hold, so a batch only ever
// pads a row up to the longest of its near-equal peers.
const formBatches = (
  encoded: readonly EncodedText[],
  maxBatchSize: number,
  maxBatchTokens: number,
): EncodedText[][] => {
  const sorted = [...encoded].sort((a, b) => a.ids.length - b.ids.length)
  const batches: EncodedText[][] = []
  let batch: EncodedText[] = []
  for (const entry of sorted) {
    // Entries are ascending, so the candidate's length is the batch max.
    const paddedTokens = (batch.length + 1) * entry.ids.length
    if (batch.length > 0 && (batch.length >= maxBatchSize || paddedTokens > maxBatchTokens)) {
      batches.push(batch)
      batch = []
    }
    batch.push(entry)
  }
  if (batch.length > 0) {
    batches.push(batch)
  }
  return batches
}

const detectBatch = async (
  loaded: LoadedModel,
  batch: readonly EncodedText[],
): Promise<readonly (readonly PrivacySpan[])[]> => {
  const rows = batch.length
  const maxLen = Math.max(...batch.map((entry) => entry.ids.length))
  const inputIds = new BigInt64Array(rows * maxLen).fill(BigInt(loaded.padTokenId))
  const attentionMask = new BigInt64Array(rows * maxLen)
  for (const [row, entry] of batch.entries()) {
    for (const [position, id] of entry.ids.entries()) {
      inputIds[row * maxLen + position] = BigInt(id)
      attentionMask[row * maxLen + position] = 1n
    }
  }

  const { logits } = await loaded.run({
    input_ids: loaded.makeTensor(inputIds, [rows, maxLen]),
    attention_mask: loaded.makeTensor(attentionMask, [rows, maxLen]),
  })
  const [logitRows, sequenceLength, classCount] = logits.dims
  if (logitRows !== rows || sequenceLength !== maxLen || classCount === undefined) {
    throw new Error(`unexpected batched logits shape: ${JSON.stringify(logits.dims)}`)
  }

  return batch.map((entry, row) => {
    const labels: TokenLabel[] = []
    for (let position = 0; position < entry.ids.length; position += 1) {
      const { bestIndex, score } = softmaxScore(
        logits.data,
        (row * maxLen + position) * classCount,
        classCount,
      )
      labels.push({ label: loaded.id2label[String(bestIndex)] ?? "O", score })
    }
    return spansFromLabeledTokens(loaded, entry.text, entry.ids, labels)
  })
}

export const createTransformersPrivacyFilter = (
  modelId: string,
  options: TransformersPrivacyFilterOptions = {},
): PrivacyFilter => ({
  detect: async (texts) => {
    let loaded: LoadedModel
    try {
      loaded = await loadModel(modelId, options.dtype ?? defaultPrivacyDtype)
    } catch (caught: unknown) {
      throw new PrivacyFilterUnavailableError(`privacy filter model failed to load: ${modelId}`, {
        cause: caught,
      })
    }
    try {
      const encoded: EncodedText[] = []
      for (const [index, text] of texts.entries()) {
        if (text.length === 0) {
          continue
        }
        const ids = loaded.tokenizer(text).input_ids.tolist()[0] ?? []
        encoded.push({ index, text, ids })
      }
      const results: (readonly PrivacySpan[])[] = texts.map(() => [])
      const batches = formBatches(
        encoded,
        options.maxBatchSize ?? defaultMaxBatchSize,
        options.maxBatchTokens ?? defaultMaxBatchTokens,
      )
      for (const batch of batches) {
        const spans = await detectBatch(loaded, batch)
        for (const [row, entry] of batch.entries()) {
          results[entry.index] = spans[row] ?? []
        }
      }
      return results
    } catch (caught: unknown) {
      if (caught instanceof PrivacyFilterUnavailableError) {
        throw caught
      }
      throw new PrivacyFilterUnavailableError(`privacy filter inference failed: ${modelId}`, {
        cause: caught,
      })
    }
  },
})
