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

export class StatusClientError extends Error {
  public constructor(
    public readonly code: PublishErrorCode | PublishWireContractErrorCode,
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
    throw new StatusClientError("invalid_response");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxResponseBytes) {
    throw new StatusClientError("invalid_response");
  }
  return bytes;
};

export const createStatusClient = (
  server: string,
  requestClient: KyInstance = ky,
): StatusClient => ({
  read: async (request) => {
    if (!validPublishCredential(request.credential)) {
      throw new StatusClientError("unauthorized");
    }
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMilliseconds);
    const signal =
      request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);
    try {
      const response = await requestClient.get(
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
        throw new StatusClientError("unavailable");
      }
      const parsed = parsePublishResponse(
        response.status,
        await boundedResponseBytes(response),
      );
      if ("code" in parsed) throw new StatusClientError(parsed.code);
      if ("statusUrl" in parsed) throw new StatusClientError("invalid_response");
      return parsed;
    } catch (error) {
      if (error instanceof StatusClientError) throw error;
      if (error instanceof PublishWireContractError) {
        throw new StatusClientError(error.code);
      }
      throw new StatusClientError("unavailable");
    }
  },
});
