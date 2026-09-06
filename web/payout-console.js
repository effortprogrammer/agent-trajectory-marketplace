import {
  formatPayoutAmount,
  parsePayoutResponse,
} from "./console-contract.799162ebbe8dcf5683e138ca389be898fda29d96c6d45915fabd393c28d38df9.js";

const renderWalletBalance = (root, state, availableMinor) => {
  root.dataset.walletState = state;
  root.setAttribute("aria-busy", String(state === "loading"));
  const balance = root.querySelector("[data-console-wallet-balance]");
  if (balance) {
    balance.textContent = state === "ready"
      ? formatPayoutAmount(availableMinor)
      : state === "loading" ? "Loading..." : "Unavailable";
  }
};

export const createWalletBalanceController = ({
  canRefresh,
  isCurrent,
  requestJson,
  root,
  session,
  showLogin,
}) => {
  const abort = new AbortController();
  let inFlight;
  let refreshQueued = false;
  const button = root.querySelector("[data-wallet-refresh]");
  const eligible = () => isCurrent() && canRefresh();
  const drain = async () => {
    do {
      refreshQueued = false;
      if (!eligible()) return;
      try {
        const body = await requestJson("/v1/marketplace/seller/payout-request", {
          headers: { authorization: `Bearer ${session.accessToken}` },
          signal: abort.signal,
        });
        if (!isCurrent()) return;
        if (!refreshQueued) {
          renderWalletBalance(root, "ready", parsePayoutResponse(body).payoutRequest.availableMinor);
        }
      } catch (error) {
        if (!isCurrent()) return;
        if (error?.status === 401) {
          showLogin();
          return;
        }
        if (!refreshQueued) renderWalletBalance(root, "unavailable");
      }
    } while (refreshQueued && eligible());
  };
  const refresh = () => {
    if (!eligible()) return Promise.resolve();
    if (inFlight !== undefined) {
      refreshQueued = true;
      return inFlight;
    }
    renderWalletBalance(root, "loading");
    button?.setAttribute("aria-disabled", "true");
    inFlight = drain().finally(() => {
      inFlight = undefined;
      refreshQueued = false;
      if (isCurrent()) button?.setAttribute("aria-disabled", "false");
    });
    return inFlight;
  };
  return { cancel: () => abort.abort(), refresh };
};
