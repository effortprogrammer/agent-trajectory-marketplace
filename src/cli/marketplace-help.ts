const helpTexts = new Map<string, string>([
  ["marketplace seller candidate bundle --help", "Usage: trajectory marketplace seller candidate bundle --root <absolute-dir> [--print-selection] [--out <absolute-zip> [--trace <relative-path>... | --selection <absolute-json>]]\n\nPreview the exact upload set with --print-selection (no writes, no network), edit the document by removing traces, then build with --selection."],
  ["marketplace seller candidate publish --help", "Usage: trajectory marketplace seller candidate publish --bundle <absolute-zip> --server <url> [--api-key <key>] [--selection <absolute-json>]\n\nPublish a candidate bundle to the marketplace. With --selection, the bundle membership must exactly match the approved selection document before any request.\n\nCredential precedence: --api-key, TRAJECTORY_REGISTRY_API_KEY, active stored login token."],
  ["marketplace seller wallet balance --help", "Usage: trajectory marketplace seller wallet balance --server <url> [--api-key <key>]\n\nRead your aggregate wallet balance.\n\nCredential precedence: --api-key, TRAJECTORY_REGISTRY_API_KEY, active stored login token."],
]);

export const printMarketplaceHelp = (marketplaceArguments: readonly string[]): boolean => {
  const text = helpTexts.get(marketplaceArguments.join(" "));
  if (text === undefined) return false;
  console.log(text);
  return true;
};
