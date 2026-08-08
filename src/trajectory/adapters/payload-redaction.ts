const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+={0,2}/gi,
  /\b(?:auth|authorization|api[_-]?key|bearer|cookie|credentials?|key|pass|password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|sk-proj)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)[^\s]*/gi,
  /\b(?:[A-Za-z0-9]+_)*(?:API_?KEY|ACCESS_?KEY|SECRET_?KEY|SESSION_?TOKEN|ACCESS_?TOKEN|REFRESH_?TOKEN|CLIENT_?SECRET|PRIVATE_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|AUTH|CREDENTIALS?|KEY)(?:_[A-Za-z0-9]+)*\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)[^\s]*/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
] as const;
const escapedQuotedCredentialPattern = /((?:[\\])(["'])(?:auth|authorization|api[_-]?key|bearer|cookie|credentials?|key|pass|password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|sk-proj)(?:[\\])\2\s*[:=]\s*)((?:[\\])(["']))(?:[\\][\\].|(?![\\]\4)[^\r\n])*[\\]\4/gi;
const quotedCredentialPattern = /((["'])(?:auth|authorization|api[_-]?key|bearer|cookie|credentials?|key|pass|password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|sk-proj)\2\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,}\]]+)/gi;
const sensitiveKeyMarkers = new Set([
  "password", "passwd", "pass", "pwd", "auth", "authorization", "token", "key", "secret",
  "credential", "credentials", "cookie",
]);
const sensitiveKeyCompounds = new Set([
  "apikey", "accesstoken", "refreshtoken", "authtoken", "clientsecret", "privatekey", "bearer", "skproj",
]);

const redactCredentialSpans = (value: string): string => {
  let redacted = value.replace(escapedQuotedCredentialPattern, (_match, prefix: string, _keyQuote: string, valueOpen: string) =>
    `${prefix}${valueOpen}[redacted]${valueOpen}`,
  );
  redacted = redacted.replace(quotedCredentialPattern, (match, prefix: string) => {
    const valueQuote = match[prefix.length];
    return valueQuote === '"' || valueQuote === "'"
      ? `${prefix}${valueQuote}[redacted]${valueQuote}`
      : `${prefix}[redacted]`;
  });
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
