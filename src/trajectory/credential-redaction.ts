// Precise credential detection for high-fidelity trajectory payloads.
//
// The bounded `detail` lane uses a blunt dictionary scan (containsSecretMarker
// in evidence.ts): any 240-char summary containing "token"/"secret" is
// rejected. That is safe for one-line summaries but ruinous for full tool
// outputs, where "token count", "secret santa", or a "password reset" test
// log are ordinary content — a blunt scan would redact away the fidelity we
// are trying to sell.
//
// Payloads therefore use credential *patterns* — the actual shapes of leaked
// secrets — so real credentials are caught while innocuous mentions of the
// words survive. Used both to redact at collection (adapter) and to reject at
// intake (escrow) as the fail-closed backstop.

export const redactedMarker = "[redacted]"

// Each pattern matches a concrete credential shape. Order/independence does
// not matter; every match is replaced with the marker.
const credentialPatterns: readonly RegExp[] = [
  // Authorization: Bearer <token>, or a bare "Bearer <token>".
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
  // key: value / key = value where the key names a secret and the value looks
  // like a credential (12+ credential-alphabet chars).
  /\b(?:authorization|api[_-]?key|secret|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}={0,2}/gi,
  // Provider token shapes.
  /\bsk-[A-Za-z0-9]{20,}/g, // OpenAI-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub PAT/OAuth
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key id
  /\bAIza[A-Za-z0-9_-]{20,}/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT (three segments)
  // PEM private key blocks.
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
]

// Replaces every credential-pattern span in `text` with the redaction marker.
// Innocuous mentions of secret-adjacent words are left intact.
export const redactCredentialSpans = (text: string): string => {
  let out = text
  for (const pattern of credentialPatterns) {
    out = out.replace(pattern, redactedMarker)
  }
  return out
}

// True when `text` still contains a credential-shaped span (i.e. was not
// redacted). The intake backstop for payloads that did not pass through our
// adapter's collection-time redaction.
export const containsCredentialPattern = (text: string): boolean =>
  credentialPatterns.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })

// Recursively scans an arbitrary value (a high-fidelity event payload is any
// JSON) for a credential-shaped span in any string leaf. The escrow intake
// backstop over full-fidelity payloads, which the blunt detail-lane dictionary
// scan would either miss (it only reads detail) or over-reject.
export const containsCredentialInValue = (value: unknown): boolean => {
  if (typeof value === "string") {
    return containsCredentialPattern(value)
  }
  if (Array.isArray(value)) {
    return value.some(containsCredentialInValue)
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsCredentialInValue)
  }
  return false
}
