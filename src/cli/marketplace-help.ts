const helpTexts = new Map<string, string>([
  ["marketplace seller sessions --help", "Usage: trajectory marketplace seller sessions <command>\n\nCommands:\n  sessions list\n  sessions inspect\n  sessions choose"],
  ["marketplace seller sessions list --help", "Usage: trajectory marketplace seller sessions list --root <absolute-dir> [--json]\n\nList collected ATF sessions with bounded local summaries. No writes and no network."],
  ["marketplace seller sessions inspect --help", "Usage: trajectory marketplace seller sessions inspect <selector> --root <absolute-dir> [--json]\n\nInspect one collected ATF session locally by its full selector. No writes and no network."],
  ["marketplace seller sessions choose --help", "Usage: trajectory marketplace seller sessions choose --root <absolute-dir> [--json]\n       trajectory marketplace seller sessions choose --root <absolute-dir> --out <absolute-json> --approve <full-selector>@<source-sha256> [--approve <full-selector>@<source-sha256>...]\n\nPreview bounded session topics and upload admission locally, then write a content-bound selection document containing only explicitly approved ready sessions. Raw session content never leaves the machine."],
  ["marketplace seller candidate bundle --help", "Usage: trajectory marketplace seller candidate bundle --root <absolute-dir> [--deny-policy <absolute-json>] [--print-selection] [--out <absolute-zip> [--trace <relative-path>...] [--review-cache <absolute-dir> --review-policy <bounded-id> | --selection <absolute-json>]]\n\nPreview the exact upload set with --print-selection (no writes, no network), edit the document by removing traces, then build with --selection. Reuse --deny-policy during construction so denied candidates cannot be reintroduced. Policy JSON is {\"schemaVersion\":1,\"patterns\":[\"text\"]}. Private review sidecars are content-addressed under --review-cache and are never included in the candidate archive."],
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
