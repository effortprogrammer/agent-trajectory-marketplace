const helpTexts = new Map<string, string>([
  ["marketplace seller candidate bundle --help", "Usage: trajectory marketplace seller candidate bundle --root <absolute-dir> [--deny-policy <absolute-json>] [--print-selection] [--out <absolute-zip> [--trace <relative-path>... | --selection <absolute-json>]]\n\nPreview the exact upload set with --print-selection (no writes, no network), edit the document by removing traces, then build with --selection. Reuse --deny-policy during construction so denied candidates cannot be reintroduced. Policy JSON is {\"schemaVersion\":1,\"patterns\":[\"text\"]}."],
  ["marketplace seller candidate search --help", "Usage: trajectory marketplace seller candidate search --root <absolute-dir> --query <text> [--deny-policy <absolute-json>]\n\nSearch sanitized uploadable candidate content. Output contains only stable selector/count receipts."],
  ["marketplace seller candidate publish --help", "Usage: trajectory marketplace seller candidate publish --bundle <absolute-zip> [--api-key <key>] [--selection <absolute-json>]\n\nPublish a candidate bundle to the official ATM gateway. With --selection, the bundle membership must exactly match the approved selection document before any request.\n\nCredential precedence: --api-key, TRAJECTORY_REGISTRY_API_KEY, active stored login token."],
  ["marketplace seller candidate status --help", "Usage: trajectory marketplace seller candidate status --submission <submission-id> [--api-key <key>]\n\nRead candidate processing status from the official ATM gateway.\n\nCredential precedence: --api-key, TRAJECTORY_REGISTRY_API_KEY, active stored login token."],
  ["marketplace seller wallet balance --help", "Usage: trajectory marketplace seller wallet balance [--api-key <key>]\n\nRead your aggregate wallet balance from the official ATM gateway.\n\nCredential precedence: --api-key, TRAJECTORY_REGISTRY_API_KEY, active stored login token."],
]);

export const printMarketplaceHelp = (marketplaceArguments: readonly string[]): boolean => {
  const text = helpTexts.get(marketplaceArguments.join(" "));
  if (text === undefined) return false;
  console.log(text);
  return true;
};
