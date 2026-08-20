const CANONICAL_ORIGIN = "https://getatm.io";
const REGISTRY_ORIGIN = "https://gateway.getatm.io";
const REGISTRY_PATH = "/v1/marketplace/waitlist";
const MAX_REQUEST_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 4_096;
const INBOUND_REQUEST_BODY_TIMEOUT_MS = 5_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const EXPECTED_REGISTRY_STATUSES = new Set([202, 400, 413, 415, 429]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const responseHeaders = (contentType = "application/json") => ({
  "cache-control": "private, no-store",
  "content-type": contentType,
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-robots-tag": "noindex, nofollow, noarchive",
});

const errorResponse = (status, code, message, allow) => {
  const headers = responseHeaders();
  if (allow) headers.allow = allow;
  return Response.json(
    { error: { code, message } },
    { headers, status },
  );
};
class RequestBodyTimeoutError extends Error {}

const readWithDeadline = (reader, deadline) => {
  if (deadline === undefined) return reader.read();
  if (deadline.aborted) return Promise.reject(new RequestBodyTimeoutError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RequestBodyTimeoutError());
    deadline.addEventListener("abort", abort, { once: true });
    reader.read().then(resolve, reject).finally(() => deadline.removeEventListener("abort", abort));
  });
};

const readBoundedBody = async (message, maximumBytes, deadline) => {
  const contentLength = message.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    return null;
  }
  if (message.body === null) return new Uint8Array();
  const reader = message.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await readWithDeadline(reader, deadline);
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyTimeoutError) {
      // Do not await an untrusted stalled source while returning the bounded timeout.
      void reader.cancel().catch(() => {});
    }
    throw error;
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

const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (body) => hex(await crypto.subtle.digest("SHA-256", body));

const hmacHex = async (secret, canonical) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
};

const validSecret = (secret) =>
  typeof secret === "string" && encoder.encode(secret).byteLength >= 32;

const defaultDependencies = {
  fetcher: (request) => fetch(request),
  nonce: () => crypto.randomUUID(),
  now: () => Date.now(),
  requestBodyTimeoutSignal: () => AbortSignal.timeout(INBOUND_REQUEST_BODY_TIMEOUT_MS),
  timeoutSignal: () => AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
};

export const handleWaitlist = async (
  request,
  environment,
  dependencies = defaultDependencies,
) => {
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "method not allowed", "POST");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    return errorResponse(415, "unsupported_media_type", "content type must be application/json");
  }
  const source = request.headers.get("cf-connecting-ip")?.trim().toLowerCase();
  if (!source) {
    return errorResponse(400, "invalid_request", "request source is unavailable");
  }
  const secret = environment?.REGISTRY_WAITLIST_EDGE_SECRET;
  if (!validSecret(secret)) {
    return errorResponse(503, "service_unavailable", "waitlist is unavailable");
  }
  let body;
  try {
    body = await readBoundedBody(
      request,
      MAX_REQUEST_BYTES,
      (dependencies.requestBodyTimeoutSignal ?? defaultDependencies.requestBodyTimeoutSignal)(),
    );
  } catch (error) {
    if (error instanceof RequestBodyTimeoutError) {
      return errorResponse(408, "request_timeout", "request timed out");
    }
    throw error;
  }
  if (body === null) {
    return errorResponse(413, "payload_too_large", "request body is too large");
  }
  try {
    const parsed = JSON.parse(decoder.decode(body));
    if (
      parsed === null
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || parsed.acceptContact !== true
    ) {
      return errorResponse(400, "invalid_request", "request body is invalid");
    }
  } catch {
    return errorResponse(400, "invalid_request", "request body is invalid");
  }

  const timestamp = Math.floor(dependencies.now() / 1_000).toString();
  const nonce = dependencies.nonce().toLowerCase();
  const canonical = [
    "POST",
    REGISTRY_PATH,
    timestamp,
    nonce,
    source,
    await sha256Hex(body),
  ].join("\n");
  const signature = await hmacHex(secret, canonical);
  const upstreamRequest = new Request(`${REGISTRY_ORIGIN}${REGISTRY_PATH}`, {
    body,
    headers: {
      "content-type": "application/json",
      origin: CANONICAL_ORIGIN,
      "x-atm-waitlist-nonce": nonce,
      "x-atm-waitlist-signature": signature,
      "x-atm-waitlist-source": source,
      "x-atm-waitlist-timestamp": timestamp,
    },
    method: "POST",
    redirect: "manual",
    signal: dependencies.timeoutSignal(),
  });

  let upstreamResponse;
  try {
    upstreamResponse = await dependencies.fetcher(upstreamRequest);
  } catch (error) {
    const timedOut = error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError");
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut ? "gateway_timeout" : "bad_gateway",
      timedOut ? "waitlist request timed out" : "waitlist request failed",
    );
  }
  if (!EXPECTED_REGISTRY_STATUSES.has(upstreamResponse.status)) {
    return errorResponse(502, "bad_gateway", "waitlist request failed");
  }
  let responseBytes;
  try {
    responseBytes = await readBoundedBody(upstreamResponse, MAX_RESPONSE_BYTES);
  } catch (error) {
    const timedOut = error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError");
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut ? "gateway_timeout" : "bad_gateway",
      timedOut ? "waitlist request timed out" : "waitlist request failed",
    );
  }
  if (responseBytes === null) {
    return errorResponse(502, "bad_gateway", "waitlist request failed");
  }
  const responseBody = decoder.decode(responseBytes);
  try {
    JSON.parse(responseBody);
  } catch {
    return errorResponse(502, "bad_gateway", "waitlist request failed");
  }
  return new Response(responseBody, {
    headers: responseHeaders(),
    status: upstreamResponse.status,
  });
};
