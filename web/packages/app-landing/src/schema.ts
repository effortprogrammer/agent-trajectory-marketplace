import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);
const assetPath = nonEmptyText.refine(
  (value) => value.startsWith("/") || value.startsWith("https://"),
  "Media paths must be root-relative or HTTPS URLs.",
);

export const landingCtaSchema = z.object({
  label: nonEmptyText,
  href: nonEmptyText,
});

export const landingMediaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    src: assetPath,
    alt: nonEmptyText,
  }),
  z.object({
    kind: z.literal("video"),
    src: assetPath,
    alt: nonEmptyText,
    poster: assetPath.optional(),
  }),
]);

export const landingPreviewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inline"),
    title: nonEmptyText,
  }),
  z.object({
    kind: z.literal("route"),
    title: nonEmptyText,
    src: nonEmptyText,
    openHref: nonEmptyText,
    openLabel: nonEmptyText,
  }),
  z.object({
    kind: z.literal("media"),
    title: nonEmptyText,
    media: landingMediaSchema,
    openHref: nonEmptyText,
    openLabel: nonEmptyText,
  }),
]);

export const landingIconSchema = z.enum([
  "check",
  "clock",
  "frame",
  "image",
  "layers",
  "shield",
  "sliders",
  "sparkles",
  "video",
  "wand",
]);

const landingStepBaseSchema = z.object({
  title: nonEmptyText,
  description: nonEmptyText,
});

export const landingStepInstructionPreviewSchema = z.object({
  kind: z.literal("instruction"),
  icon: landingIconSchema,
  title: nonEmptyText,
  description: nonEmptyText.optional(),
});

export const landingStepActionPreviewSchema = z.object({
  kind: z.literal("action"),
  label: nonEmptyText,
});

export const landingStepResultPreviewSchema = z.object({
  kind: z.literal("result"),
  media: landingMediaSchema,
});

export const landingStepPreviewSchema = z.discriminatedUnion("kind", [
  landingStepInstructionPreviewSchema,
  landingStepActionPreviewSchema,
  landingStepResultPreviewSchema,
]);

export const landingContentSchema = z.object({
  hero: z.object({
    eyebrow: nonEmptyText.optional(),
    title: nonEmptyText,
    description: nonEmptyText,
    primaryCta: landingCtaSchema,
    secondaryCta: landingCtaSchema.optional(),
  }),
  preview: landingPreviewSchema,
  steps: z.object({
    title: nonEmptyText,
    description: nonEmptyText.optional(),
    items: z.tuple([
      landingStepBaseSchema.extend({ preview: landingStepInstructionPreviewSchema }),
      landingStepBaseSchema.extend({ preview: landingStepActionPreviewSchema }),
      landingStepBaseSchema.extend({ preview: landingStepResultPreviewSchema }),
    ]),
  }),
  features: z.object({
    title: nonEmptyText,
    description: nonEmptyText.optional(),
    items: z
      .array(
        z.object({
          icon: landingIconSchema,
          title: nonEmptyText,
          description: nonEmptyText,
        }),
      )
      .length(3),
  }),
  showcase: z.object({
    title: nonEmptyText,
    description: nonEmptyText.optional(),
    items: z
      .array(
        z.object({
          label: nonEmptyText,
          media: landingMediaSchema,
        }),
      )
      .min(1)
      .max(6),
  }),
  finalCta: z.object({
    title: nonEmptyText,
    description: nonEmptyText,
    action: landingCtaSchema,
    backgroundMedia: landingMediaSchema.optional(),
  }),
});

export type LandingContent = z.infer<typeof landingContentSchema>;
export type LandingIconName = z.infer<typeof landingIconSchema>;
export type LandingMedia = z.infer<typeof landingMediaSchema>;
export type LandingStepPreview = z.infer<typeof landingStepPreviewSchema>;

export function parseLandingContent(input: unknown): LandingContent {
  return landingContentSchema.parse(input);
}
