import ky from "ky";
import { z } from "zod";

import {
  parseStableVersion,
  ReleaseContractError,
  UPDATE_RELEASE,
} from "./update-release-contract";

const latestReleaseSchema = z
  .object({
    tag_name: z.string(),
    draft: z.literal(false),
    prerelease: z.literal(false),
    immutable: z.literal(true),
  })
  .passthrough();

const latestReleaseUrl =
  `https://api.github.com/repos/${UPDATE_RELEASE.repository}/releases/latest`;

export type LatestVersionReader = (signal: AbortSignal) => Promise<string>;

const readBoundedBody = async (
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ReleaseContractError(
          "invalid-release",
          "latest release response exceeds size limit",
        );
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const createGitHubLatestVersionReader = (): LatestVersionReader =>
  async (signal): Promise<string> => {
    const response = await ky(latestReleaseUrl, {
      headers: { accept: "application/vnd.github+json" },
      redirect: "manual",
      retry: 0,
      signal,
      throwHttpErrors: false,
      timeout: false,
    });
    if (response.status !== 200) {
      throw new ReleaseContractError(
        "invalid-release",
        "latest release request failed",
      );
    }
    const body = await readBoundedBody(response, UPDATE_RELEASE.manifestMaxBytes);
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
    const release = latestReleaseSchema.parse(decoded);
    if (!release.tag_name.startsWith("v")) {
      throw new ReleaseContractError(
        "invalid-release",
        "latest release tag is not stable",
      );
    }
    return parseStableVersion(release.tag_name.slice(1));
  };
