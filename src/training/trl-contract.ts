import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const trlToolCallSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1),
        arguments: jsonObjectSchema,
      })
      .strict(),
  })
  .strict();

const trlTextMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .strict();

const trlToolCallingMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.string().optional(),
    tool_calls: z.array(trlToolCallSchema).min(1),
  })
  .strict();

const trlToolResultMessageSchema = z
  .object({
    role: z.literal("tool"),
    name: z.string().min(1),
    content: z.string(),
  })
  .strict();

export const trlMessageSchema = z.union([
  trlTextMessageSchema,
  trlToolCallingMessageSchema,
  trlToolResultMessageSchema,
]);

const jsonSchemaPropertySchema: z.ZodType<Readonly<Record<string, unknown>>> =
  z.record(z.string(), z.unknown());

export const trlToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1),
        description: z.string().min(1),
        parameters: z
          .object({
            type: z.literal("object"),
            properties: z.record(z.string(), jsonSchemaPropertySchema),
            required: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const trlTrainingRecordSchema = z
  .object({
    messages: z.array(trlMessageSchema).min(2),
    tools: z.array(trlToolSchema),
  })
  .strict();

export type TrlMessage = z.infer<typeof trlMessageSchema>;
export type TrlTool = z.infer<typeof trlToolSchema>;
export type TrlToolCall = z.infer<typeof trlToolCallSchema>;
export type TrlTrainingRecord = z.infer<typeof trlTrainingRecordSchema>;
