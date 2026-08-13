import ky, { type KyInstance } from "ky";

import {
  parsePublishResponse,
  PublishWireContractError,
  type PublishErrorCode,
  type PublishStatus,
  type PublishWireContractErrorCode,
} from "@/marketplace/publish-contract";
import { validPublishCredential } from "@/marketplace/publish-client";

const maxResponseBytes = 64 * 1024;
const requestTimeoutMilliseconds = 10_000;

type StatusClientOptions = Readonly<{
  readonly requestClient?: KyInstance;
  readonly timeoutMilliseconds?: number;
}>;

export class StatusClientError extends Error {
  public constructor(
    public readonly code:
      | PublishErrorCode
      | PublishWireContractErrorCode
      | "cancelled"
      | "timeout",
  ) {
    super(code);
    this.name = "StatusClientError";
  }
}

type StatusRequest = Readonly<{
  readonly credential: string;
  readonly signal?: AbortSignal;
  readonly submissionId: string;
}>;

type StatusClient = Readonly<{
  readonly read: (request: StatusRequest) => Promise<PublishStatus>;
}>;

const boundedResponseBytes = async (response: Response): Promise<Uint8Array> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel();
    throw new StatusClientError("invalid_response");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new StatusClientError("invalid_response");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const createStatusClient = (
  server: string,
  options: StatusClientOptions = {},
): StatusClient => ({
  read: async (request) => {
    if (!validPublishCredential(request.credential)) {
      throw new StatusClientError("unauthorized");
    }
    const timeoutSignal = AbortSignal.timeout(
      options.timeoutMilliseconds ?? requestTimeoutMilliseconds,
    );
    const signal =
      request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);
    try {
      const response = await (options.requestClient ?? ky).get(
        `${server}/v1/marketplace/seller/candidates/${request.submissionId}`,
        {
          headers: { authorization: `Bearer ${request.credential}` },
          redirect: "manual",
          retry: 0,
          signal,
          throwHttpErrors: false,
        },
      );
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new StatusClientError("unavailable");
      }
      const parsed = parsePublishResponse(
        response.status,
        await boundedResponseBytes(response),
      );
      if ("code" in parsed) throw new StatusClientError(parsed.code);
      if ("statusUrl" in parsed) throw new StatusClientError("invalid_response");
      if (parsed.submissionId !== request.submissionId) {
        throw new StatusClientError("invalid_response");
      }
      return parsed;
    } catch (error) {
      if (error instanceof StatusClientError) throw error;
      if (error instanceof PublishWireContractError) {
        throw new StatusClientError(error.code);
      }
      if (request.signal?.aborted === true) {
        throw new StatusClientError("cancelled");
      }
      if (timeoutSignal.aborted) throw new StatusClientError("timeout");
      throw new StatusClientError("unavailable");
    }
  },
});
