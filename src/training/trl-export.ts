import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { harnessTraceDocumentSchema, type HarnessTraceEvent } from "@/trajectory/adapters/contract";
import {
  trlTrainingRecordSchema,
  type TrlMessage,
  type TrlTool,
  type TrlToolCall,
  type TrlTrainingRecord,
} from "./trl-contract";
export const TrlExportErrorCode = {
  EmptyTrainingExample: "empty_training_example",
  InvalidAtf: "invalid_atf",
  InvalidDatasetRequest: "invalid_dataset_request",
  UnsafeInputPath: "unsafe_input_path",
  UnsafeOutputPath: "unsafe_output_path",
  UnsupportedAtfVersion: "unsupported_atf_version",
} as const;
export type TrlExportErrorCode =
  (typeof TrlExportErrorCode)[keyof typeof TrlExportErrorCode];

export class TrlExportError extends Error {
  readonly code: TrlExportErrorCode;

  constructor(code: TrlExportErrorCode) {
    super(code);
    this.name = "TrlExportError";
    this.code = code;
  }
}
export type TrlExportResult = Readonly<{
  exampleCount: 1;
  inputPath: string;
  messageCount: number;
  outputPath: string;
  runtime: string;
  toolCount: number;
}>;
type JsonObject = Readonly<Record<string, unknown>>;

const jsonObject = (value: unknown): JsonObject => {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed));
      }
      return { value: parsed };
    } catch (error) {
      if (error instanceof SyntaxError) return { value };
      throw error;
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return value === undefined ? {} : { value };
};

const text = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
};

const jsonType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "object":
      return "object";
    case "string":
      return "string";
    default:
      return "string";
  }
};

const toolSchema = (runtime: string, name: string, input: JsonObject): TrlTool => ({
  type: "function",
  function: {
    name,
    description: `Tool observed in the collected ${runtime} trajectory.`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, { type: jsonType(value) }]),
      ),
      required: Object.keys(input).sort(),
    },
  },
});

const appendToolCall = (
  messages: TrlMessage[],
  call: TrlToolCall,
): void => {
  const previous = messages.at(-1);
  if (previous?.role === "assistant" && "tool_calls" in previous) {
    messages[messages.length - 1] = {
      ...previous,
      tool_calls: [...previous.tool_calls, call],
    };
    return;
  }
  if (previous?.role === "assistant") {
    messages[messages.length - 1] = {
      role: "assistant",
      ...(previous.content.length === 0 ? {} : { content: previous.content }),
      tool_calls: [call],
    };
    return;
  }
  messages.push({ role: "assistant", tool_calls: [call] });
};

const eventTextMessage = (event: HarnessTraceEvent): TrlMessage | undefined => {
  const content = event.payload?.content;
  if (typeof content !== "string" || content.length === 0) return undefined;
  if (event.kind === "function_enter" && event.payload?.role === "user") {
    return { role: "user", content };
  }
  if (event.kind === "llm_call" && event.payload?.role === "assistant") {
    return { role: "assistant", content };
  }
  return undefined;
};

export const atfTraceToTrlRecord = (raw: unknown): Readonly<{
  record: TrlTrainingRecord;
  runtime: string;
}> => {
  const parsed = harnessTraceDocumentSchema.safeParse(raw);
  if (!parsed.success) throw new TrlExportError(TrlExportErrorCode.InvalidAtf);
  if (parsed.data.formatVersion !== 2) {
    throw new TrlExportError(TrlExportErrorCode.UnsupportedAtfVersion);
  }

  const messages: TrlMessage[] = [];
  const observedTools = new Map<string, TrlTool>();
  let conversationStarted = false;
  for (const event of parsed.data.events) {
    const message = eventTextMessage(event);
    if (message !== undefined) {
      if (!conversationStarted && message.role !== "user") continue;
      conversationStarted = true;
      messages.push(message);
      continue;
    }
    if (!conversationStarted) continue;
    if (event.kind === "tool_call") {
      const input = jsonObject(event.payload?.input);
      appendToolCall(messages, {
        type: "function",
        function: { name: event.name, arguments: input },
      });
      const existing = observedTools.get(event.name);
      if (existing === undefined) observedTools.set(event.name, toolSchema(parsed.data.runtime, event.name, input));
      continue;
    }
    if (event.kind === "tool_result") {
      messages.push({
        role: "tool",
        name: event.name,
        content: text(event.payload?.output),
      });
    }
  }

  const hasUser = messages.some((message) => message.role === "user");
  const hasAssistant = messages.some((message) => message.role === "assistant");
  if (!hasUser || !hasAssistant) {
    throw new TrlExportError(TrlExportErrorCode.EmptyTrainingExample);
  }
  const tools = [...observedTools.values()].sort((left, right) =>
    left.function.name.localeCompare(right.function.name)
  );
  return {
    record: trlTrainingRecordSchema.parse({ messages, tools }),
    runtime: parsed.data.runtime,
  };
};

const explicitRegularFile = (path: string): string => {
  if (!isAbsolute(path) || !existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
    throw new TrlExportError(TrlExportErrorCode.UnsafeInputPath);
  }
  return resolve(path);
};

const explicitOutputPath = (path: string): string => {
  if (!isAbsolute(path) || (existsSync(path) && lstatSync(path).isSymbolicLink())) {
    throw new TrlExportError(TrlExportErrorCode.UnsafeOutputPath);
  }
  return resolve(path);
};

const readTrace = (inputPath: string): unknown => {
  try {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new TrlExportError(TrlExportErrorCode.InvalidAtf);
    throw error;
  }
};

export const exportAtfToTrl = (input: Readonly<{
  inputPath: string;
  outputPath: string;
}>): TrlExportResult => {
  const inputPath = explicitRegularFile(input.inputPath);
  const outputPath = explicitOutputPath(input.outputPath);
  const converted = atfTraceToTrlRecord(readTrace(inputPath));
  const outputDirectory = dirname(outputPath);
  mkdirSync(outputDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.trajectory-tmp-${crypto.randomUUID()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(converted.record)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return {
    exampleCount: 1,
    inputPath,
    messageCount: converted.record.messages.length,
    outputPath,
    runtime: converted.runtime,
    toolCount: converted.record.tools.length,
  };
};
