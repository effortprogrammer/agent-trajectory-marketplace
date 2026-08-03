import type { Generation, JobPhase, OutputType } from "@higgsfield/fnf/client";
import {
  getJobPhase,
  getMediaType,
  getPreviewUrl,
  getRawUrl,
  hasResult,
  isTerminalJobStatus,
} from "@higgsfield/fnf/client";

export type GenerationMediaPreview =
  | {
      kind: "image";
      phase: JobPhase;
      previewUrl: string;
      rawUrl: string;
    }
  | {
      kind: "video";
      phase: JobPhase;
      rawUrl: string;
      posterUrl?: string;
      previewUrl?: string;
    }
  | {
      kind: "empty";
      phase: JobPhase;
      outputType: OutputType;
      terminal: boolean;
      reason: "pending" | "preview_unavailable" | "failed";
    };

export function selectGenerationMedia(generation: Generation): GenerationMediaPreview {
  const phase = getJobPhase(generation);
  const outputType = getMediaType(generation) ?? generation.type;

  if (!hasResult(generation)) {
    return {
      kind: "empty",
      phase,
      outputType,
      terminal: isTerminalJobStatus(generation.status),
      reason:
        phase === "failed"
          ? "failed"
          : generation.status === "completed"
            ? "preview_unavailable"
            : "pending",
    };
  }

  const rawUrl = getRawUrl(generation);
  const previewUrl = getPreviewUrl(generation);

  if (!rawUrl) {
    return {
      kind: "empty",
      phase,
      outputType,
      terminal: isTerminalJobStatus(generation.status),
      reason: generation.status === "completed" ? "preview_unavailable" : "pending",
    };
  }

  if (outputType === "video") {
    const posterUrl =
      generation.results.thumbnailUrl ??
      (previewUrl && getMediaType(previewUrl) === "image" ? previewUrl : undefined);
    return {
      kind: "video",
      phase,
      rawUrl,
      ...(previewUrl ? { previewUrl } : {}),
      ...(posterUrl ? { posterUrl } : {}),
    };
  }

  return {
    kind: "image",
    phase,
    rawUrl,
    previewUrl: previewUrl ?? rawUrl,
  };
}

export function getGenerationPrompt(generation: Generation): string | undefined {
  const prompt = generation.input.prompt?.instruction?.trim();
  return prompt && prompt.length > 0 ? prompt : undefined;
}

export function getGenerationStatusLabel(generation: Generation): string {
  return generation.status.replaceAll("_", " ");
}

export function getGenerationCreatedLabel(generation: Generation): string | undefined {
  if (generation.createdAt === undefined) return undefined;

  const ms =
    generation.createdAt > 10_000_000_000 ? generation.createdAt : generation.createdAt * 1000;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function getGenerationFailureLabel(generation: Generation): string | undefined {
  return (
    generation.failReason?.trim() ||
    (getJobPhase(generation) === "failed" ? getGenerationStatusLabel(generation) : undefined)
  );
}
