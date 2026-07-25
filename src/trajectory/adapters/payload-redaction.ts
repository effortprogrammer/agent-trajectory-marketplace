const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+={0,2}/gi,
  /\b(?:auth|authorization|api[_-]?key|bearer|key|pass|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
] as const;
const sensitiveKeyMarkers = new Set([
  "password", "passwd", "pass", "auth", "authorization", "token", "key", "secret",
]);
const sensitiveKeyCompounds = new Set([
  "apikey", "accesstoken", "refreshtoken", "authtoken", "clientsecret", "privatekey", "bearer",
]);

const redactCredentialSpans = (value: string): string => {
  let redacted = value;
  for (const pattern of credentialPatterns) redacted = redacted.replace(pattern, "[redacted]");
  return redacted;
};

export const isSensitiveObjectKey = (key: string): boolean => {
  const normalized = key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
  return (
    normalized.split("_").some((part) => sensitiveKeyMarkers.has(part)) ||
    sensitiveKeyCompounds.has(normalized.replaceAll("_", ""))
  );
};

export const boundedRedactedString = (
  value: string,
  maxStringBytes: number,
): Readonly<{ text: string; truncated: boolean }> => {
  const redacted = redactCredentialSpans(value);
  if (Buffer.byteLength(redacted, "utf8") <= maxStringBytes) {
    return { text: redacted, truncated: false };
  }
  const marker = "…[truncated]";
  const buffer = Buffer.from(redacted, "utf8");
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (maxStringBytes < markerBytes) return { text: "", truncated: true };
  let end = maxStringBytes - markerBytes;
  while (end > 0 && (buffer[end] ?? 0) >> 6 === 0b10) end -= 1;
  return { text: `${buffer.subarray(0, end).toString("utf8")}${marker}`, truncated: true };
};
