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

export const mountWalletBalance = async ({
  isCurrent,
  requestJson,
  root,
  session,
  showLogin,
}) => {
  renderWalletBalance(root, "loading");
  try {
    const body = await requestJson("/v1/marketplace/seller/payout-request", {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    if (!isCurrent()) return;
    renderWalletBalance(
      root,
      "ready",
      parsePayoutResponse(body).payoutRequest.availableMinor,
    );
  } catch (error) {
    if (!isCurrent()) return;
    if (error?.status === 401) {
      showLogin();
      return;
    }
    renderWalletBalance(root, "unavailable");
  }
};
