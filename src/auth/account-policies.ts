export const accountPolicies = {
  privacy: {
    name: "ATM Account Privacy Notice",
    url: "https://getatm.io/legal/account-privacy/2026-08-28",
    version: "2026-08-28",
  },
  terms: {
    name: "ATM Account Terms",
    url: "https://getatm.io/legal/account-terms/2026-08-28",
    version: "2026-08-28",
  },
} as const

export const accountPolicyCliNotice = [
  `${accountPolicies.terms.name} (${accountPolicies.terms.version}):`,
  accountPolicies.terms.url,
  `${accountPolicies.privacy.name} (${accountPolicies.privacy.version}):`,
  accountPolicies.privacy.url,
  "",
].join("\n")
