import { AuthStoreError, readStoredAuthSession, storedAuthSessionStatus } from "../auth/store";
import { validPublishCredential } from "../marketplace/publish-client";

export class MarketplaceCliError extends Error {
  readonly name = "MarketplaceCliError";

  constructor(readonly code: "cancelled" | "commercial_use_consent_declined" | "commercial_use_consent_required" | "invalid_commercial_use_consent" | "invalid_command" | "missing_publish_credential" | "missing_seller_session" | "missing_wallet_credential" | "weekly_payout_limit_reached") {
    super(code);
  }
}

const resolveEnvironmentCredential = (code: "missing_publish_credential" | "missing_wallet_credential"): string => {
  const environmentCredential = process.env["TRAJECTORY_REGISTRY_API_KEY"];
  if (environmentCredential !== undefined && !validPublishCredential(environmentCredential)) {
    throw new MarketplaceCliError(code);
  }
  if (environmentCredential !== undefined) return environmentCredential;
  throw new MarketplaceCliError(code);
};

const resolveStoredCredential = (server: string, code: "missing_publish_credential" | "missing_wallet_credential"): string => {
  try {
    const session = readStoredAuthSession(server);
    if (
      session !== undefined &&
      storedAuthSessionStatus(session) === "active" &&
      validPublishCredential(session.accessToken)
    ) return session.accessToken;
  } catch (error) {
    if (code === "missing_wallet_credential" && !(error instanceof AuthStoreError)) throw error;
    if (code === "missing_publish_credential") throw new MarketplaceCliError(code);
  }
  throw new MarketplaceCliError(code);
};

export const resolveMarketplaceCredential = (
  server: string,
  apiKey: string | undefined,
  code: "missing_publish_credential" | "missing_wallet_credential",
): string => {
  if (apiKey !== undefined) {
    if (!validPublishCredential(apiKey)) throw new MarketplaceCliError(code);
    return apiKey;
  }
  if (process.env["TRAJECTORY_REGISTRY_API_KEY"] !== undefined) return resolveEnvironmentCredential(code);
  return resolveStoredCredential(server, code);
};
