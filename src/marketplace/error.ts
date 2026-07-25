import { z } from "zod";

export const marketplaceErrorCodes = [
  "invalid_root",
  "unsafe_trace_path",
  "invalid_trace",
  "invalid_selector",
  "ambiguous_selector",
  "missing_selector",
  "duplicate_trace",
  "trace_drift",
  "empty_selection",
  "invalid_review_command",
  "output_exists",
  "invalid_bundle_request",
  "snapshot_too_large",
  "unsupported_platform",
] as const;

export const marketplaceErrorCodeSchema = z.enum(marketplaceErrorCodes);
export type MarketplaceErrorCode = z.infer<typeof marketplaceErrorCodeSchema>;

export class MarketplaceError extends Error {
  readonly name = "MarketplaceError";

  constructor(
    readonly code: MarketplaceErrorCode,
    message = code,
  ) {
    super(message);
  }
}
