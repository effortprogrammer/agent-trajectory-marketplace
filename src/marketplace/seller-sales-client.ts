import ky, { isNetworkError, isTimeoutError } from "ky";

import { normalizeAuthServerUrl } from "../auth/server-url";
import { validPublishCredential } from "./publish-client";
import {
  parseLegacySellerSessionsResponse,
  parseSellerCandidatesResponse,
  parseSellerEarningsResponse,
  parseSellerLedgerResponse,
  parseSellerSessionsResponse,
  SellerSalesContractError,
  type SellerCandidatesResponse,
  type SellerCursor,
  type SellerLedgerResponse,
  type SellerOptions,
  type SellerResponse,
  type SellerSalesResource,
  type SellerSessionsResponse,
} from "./seller-sales-contract";

const requestTimeoutMs = 10_000;
const maximumPages = 100;
const legacySellerSessionsPath = "/v1/marketplace/seller/sales/sessions";
const paths = {
  candidates: "/v1/marketplace/seller/candidates",
  "sales-earnings": "/v1/marketplace/seller/sales/earnings",
  "sales-ledger": "/v1/marketplace/seller/sales/ledger",
  "sales-sessions": "/v2/marketplace/seller/sales/sessions",
} as const;
const queryKeys = {
  candidates: ["cursor", "limit"],
  "sales-earnings": ["from", "to", "interval"],
  "sales-ledger": ["cursor", "limit", "type"],
  "sales-sessions": ["cursor", "limit", "status"],
} as const;

type SellerSalesClientErrorCode = "cancelled" | "invalid_pagination" | "invalid_response" | "missing_session_credential" | "request_failed" | "timeout";
type PagedResponse = Readonly<{ readonly page: Readonly<{ readonly nextCursor: SellerCursor | null }> }>;

export class SellerSalesClientError extends Error {
  readonly name = "SellerSalesClientError";

  constructor(readonly code: SellerSalesClientErrorCode) {
    super(code);
  }
}

export type SellerSalesClient = Readonly<{
  read(resource: SellerSalesResource, credential: string, options: SellerOptions, signal?: AbortSignal): Promise<SellerResponse>;
}>;

const query = (resource: SellerSalesResource, options: SellerOptions): URLSearchParams => {
  const parameters = new URLSearchParams();
  for (const key of queryKeys[resource]) {
    const value = options[key];
    if (value !== undefined) parameters.set(key, String(value));
  }
  return parameters;
};

const requestOne = async <T>(
  origin: string,
  resource: SellerSalesResource,
  credential: string,
  options: SellerOptions,
  signal: AbortSignal | undefined,
  parse: (value: unknown) => T,
  notFoundFallback?: Readonly<{
    readonly parse: (value: unknown) => T;
    readonly path: string;
  }>,
): Promise<T> => {
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
  try {
    const parameters = query(resource, options);
    const suffix = parameters.size === 0 ? "" : `?${parameters.toString()}`;
    const requestPath = (path: string) => ky(`${origin}${path}${suffix}`, {
        headers: { authorization: `Bearer ${credential}` },
        method: "GET",
        redirect: "manual",
        retry: 0,
        signal: requestSignal,
        throwHttpErrors: false,
        timeout: requestTimeoutMs,
      });
    let response = await requestPath(paths[resource]);
    if (response.status === 404 && notFoundFallback !== undefined) {
      response = await requestPath(notFoundFallback.path);
      if (response.status !== 200) throw new SellerSalesClientError("invalid_response");
      return notFoundFallback.parse(await response.json());
    }
    if (response.status !== 200) throw new SellerSalesClientError("invalid_response");
    return parse(await response.json());
  } catch (error) {
    if (error instanceof SellerSalesClientError) throw error;
    if (error instanceof SellerSalesContractError) throw new SellerSalesClientError("invalid_response");
    if (signal?.aborted === true) throw new SellerSalesClientError("cancelled");
    if (isTimeoutError(error) || timeoutSignal.aborted) throw new SellerSalesClientError("timeout");
    if (isNetworkError(error) || error instanceof TypeError || error instanceof DOMException) {
      throw new SellerSalesClientError("request_failed");
    }
    throw error;
  }
};

const readPages = async <T extends PagedResponse>(
  options: SellerOptions,
  request: (options: SellerOptions) => Promise<T>,
  merge: (initial: T, next: T) => T,
): Promise<T> => {
  let combined = await request(options);
  const cursors = new Set<string>();
  let cursor = combined.page.nextCursor;
  while (cursor !== null) {
    if (cursors.has(cursor) || cursors.size >= maximumPages) throw new SellerSalesClientError("invalid_pagination");
    cursors.add(cursor);
    combined = merge(combined, await request({ ...options, cursor }));
    cursor = combined.page.nextCursor;
  }
  return combined;
};

const readCandidatePages = async (
  options: SellerOptions,
  request: (options: SellerOptions) => Promise<SellerCandidatesResponse>,
): Promise<SellerCandidatesResponse> => {
  let combined = await request(options);
  const cursors = new Set<string>();
  let cursor = combined.nextCursor;
  while (cursor !== null) {
    if (cursors.has(cursor) || cursors.size >= maximumPages) throw new SellerSalesClientError("invalid_pagination");
    cursors.add(cursor);
    const next = await request({ ...options, cursor });
    combined = { ...combined, nextCursor: next.nextCursor, rows: [...combined.rows, ...next.rows] };
    cursor = combined.nextCursor;
  }
  return combined;
};

export const createSellerSalesClient = (server: unknown): SellerSalesClient => {
  const origin = normalizeAuthServerUrl(server);
  return {
    read: async (resource, credential, options, signal): Promise<SellerResponse> => {
      if (!validPublishCredential(credential)) throw new SellerSalesClientError("missing_session_credential");
      if (signal?.aborted === true) throw new SellerSalesClientError("cancelled");
      switch (resource) {
        case "candidates":
          return readCandidatePages(
            options,
            (pageOptions) => requestOne(origin, resource, credential, pageOptions, signal, parseSellerCandidatesResponse),
          );
        case "sales-sessions":
          return readPages(
            options,
            (pageOptions) => requestOne(
              origin,
              resource,
              credential,
              pageOptions,
              signal,
              parseSellerSessionsResponse,
              {
                parse: parseLegacySellerSessionsResponse,
                path: legacySellerSessionsPath,
              },
            ),
            (initial, next): SellerSessionsResponse => ({ ...initial, page: next.page, sessions: [...initial.sessions, ...next.sessions] }),
          );
        case "sales-ledger":
          return readPages(
            options,
            (pageOptions) => requestOne(origin, resource, credential, pageOptions, signal, parseSellerLedgerResponse),
            (initial, next): SellerLedgerResponse => ({ ...initial, events: [...initial.events, ...next.events], page: next.page }),
          );
        case "sales-earnings":
          return requestOne(origin, resource, credential, options, signal, parseSellerEarningsResponse);
      }
    },
  };
};
