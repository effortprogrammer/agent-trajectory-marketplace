import {
  formatPayoutAmount,
  parsePayoutResponse,
} from "./console-contract.19b879da9be9f44653c8d45a3ec7d48d70b20e9a033f2f0fd41caa59781c5837.js";

const labels = {
  approved: "Approved for operator processing.",
  cancelled: "Payout request cancelled.",
  paid: "Payout marked paid.",
  pending: "Waiting for operator approval.",
  processing: "Operator processing is in progress.",
  rejected: "Payout request rejected.",
  requested: "Payout requested. Waiting for operator review.",
};

const element = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const control = (label, action, className = "signal-button") => {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
};

const render = (root, summary, actions) => {
  const { availableMinor, request, thresholdMinor } = summary;
  const state = request === null
    ? availableMinor >= thresholdMinor ? "eligible" : "below-threshold"
    : request.status;
  root.dataset.payoutState = state;
  root.hidden = state === "below-threshold";
  root.replaceChildren();
  const balance = root.closest(".seller-panel")?.querySelector("[data-payout-balance]");
  if (balance) balance.textContent = `${formatPayoutAmount(availableMinor)} available`;
  const copy = request === null
    ? state === "eligible"
      ? `Your full ${formatPayoutAmount(availableMinor)} available balance can be held for payout.`
      : null
    : labels[request.status];
  if (copy !== null) root.append(element("p", "seller-payout-status", copy));
  if (request?.status === "rejected" && request.rejectedReason !== null) {
    root.append(element("p", "seller-payout-detail", request.rejectedReason));
  }
  const controls = element("div", "seller-payout-actions");
  if (
    request === null && state === "eligible"
    || (request?.status === "cancelled" || request?.status === "rejected")
      && availableMinor >= thresholdMinor
  ) {
    const requestControl = control(
      request === null ? `Request ${formatPayoutAmount(availableMinor)}` : "Request payout again",
      actions.request,
    );
    requestControl.dataset.payoutRequest = "";
    controls.append(requestControl);
  }
  if (request?.status === "requested" || request?.status === "pending") {
    const cancel = control("Cancel request", actions.withdraw, "text-button");
    cancel.dataset.payoutCancel = "";
    controls.append(cancel);
  }
  if (controls.childElementCount > 0) root.append(controls);
};

const renderFailure = (root, state, message, refresh) => {
  root.dataset.payoutState = state;
  root.hidden = false;
  root.replaceChildren(element("p", "seller-payout-status", message));
  const button = control("Refresh payout status", refresh, "text-button");
  button.dataset.payoutRefresh = "";
  root.append(button);
};

const renderSubmitting = (root) => {
  root.dataset.payoutState = "submitting";
  root.hidden = false;
  root.replaceChildren(element("p", "seller-payout-status", "Submitting payout request..."));
  const button = element("button", "signal-button", "Submitting...");
  button.type = "button";
  button.disabled = true;
  button.dataset.payoutRequest = "";
  root.append(button);
};

export const mountPayoutConsole = async ({
  isCurrent,
  requestJson,
  root,
  session,
  showLogin,
}) => {
  let busy = false;
  let retainedOperation;
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const mutationHeaders = (operationId) => ({
    ...headers,
    "content-type": "application/json",
    "idempotency-key": operationId,
  });
  const showPayoutLogin = (error) => {
    if (error?.status !== 401) return false;
    showLogin();
    return true;
  };
  const mutate = async (path, operationId) => requestJson(path, {
    body: "{}",
    headers: mutationHeaders(operationId),
    method: "POST",
  });
  const load = async () => {
    try {
      const body = await requestJson("/v1/marketplace/seller/payout-request", { headers });
      if (!isCurrent()) return;
      render(root, parsePayoutResponse(body).payoutRequest, actions);
    } catch (error) {
      if (!isCurrent() || showPayoutLogin(error)) return;
      const missing = error?.status === 503;
      renderFailure(
        root,
        missing ? "service-unavailable" : "unavailable",
        missing ? "Payout request service is unavailable." : "Payout status is unavailable.",
        load,
      );
    }
  };
  const request = async () => {
    if (busy) return;
    busy = true;
    retainedOperation ??= crypto.randomUUID();
    renderSubmitting(root);
    try {
      const body = await mutate("/v1/marketplace/seller/payout-request", retainedOperation);
      if (!isCurrent()) return;
      retainedOperation = undefined;
      render(root, parsePayoutResponse(body).payoutRequest, actions);
      root.querySelector("[data-payout-cancel]")?.focus();
    } catch (error) {
      if (!isCurrent() || showPayoutLogin(error)) return;
      if (error?.status !== undefined) retainedOperation = undefined;
      renderFailure(
        root,
        error?.status === 503 ? "creation-disabled" : "request-failed",
        error?.status === 503
          ? "Payout requests are temporarily unavailable."
          : "Payout request could not be submitted.",
        load,
      );
    } finally {
      busy = false;
    }
  };
  const withdraw = async () => {
    if (busy) return;
    busy = true;
    try {
      const body = await mutate(
        "/v1/marketplace/seller/payout-request/withdraw",
        crypto.randomUUID(),
      );
      if (!isCurrent()) return;
      render(root, parsePayoutResponse(body).payoutRequest, actions);
      root.querySelector("[data-payout-request]")?.focus();
    } catch (error) {
      if (!isCurrent() || showPayoutLogin(error)) return;
      renderFailure(
        root,
        "withdraw-failed",
        "Payout request could not be cancelled.",
        load,
      );
    } finally {
      busy = false;
    }
  };
  const actions = { request, withdraw };
  await load();
};
