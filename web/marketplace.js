const registry = "https://gateway.getatm.io";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const numeric = (candidate) => {
  const value = Number(candidate);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

const parseStat = (candidate) => {
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
    throw new TypeError("Invalid aggregate statistic");
  }
  return candidate;
};

const formatInteger = (value) => Math.round(value).toLocaleString("en-US");
const formatCompact = (value) =>
  value >= 1e9 ? `${(value / 1e9).toFixed(2)}B`
    : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M`
      : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K`
        : formatInteger(value);

const formatValue = (value, format) =>
  format === "compact" ? formatCompact(value) : formatInteger(value);

const animateNumber = (element) => {
  const value = numeric(element.dataset.value);
  const format = element.dataset.format ?? "integer";
  if (reduceMotion.matches) {
    element.textContent = formatValue(value, format);
    return;
  }

  const startedAt = performance.now();
  const duration = 1_200;
  const render = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - ((1 - progress) ** 4);
    element.textContent = formatValue(value * eased, format);
    if (progress < 1) requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
};

const numberObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
      animateNumber(entry.target);
      observer.unobserve(entry.target);
    }
  }, { threshold: [0.6] })
  : null;

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.16 })
  : null;

const nav = document.querySelector("[data-marketplace-nav]");
const updateNavigation = () => nav?.classList.toggle("is-compact", window.scrollY > 24);
updateNavigation();
window.addEventListener("scroll", updateNavigation, { passive: true });

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const status = button.parentElement?.querySelector("[data-copy-status]");
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      button.textContent = "Copied";
      if (status) status.textContent = "Command copied to clipboard";
    } catch {
      button.textContent = "Unavailable";
      if (status) status.textContent = "Clipboard access unavailable";
    }
    button.addEventListener("blur", () => {
      button.textContent = "Copy";
      if (status) status.textContent = "";
    }, { once: true });
  });
}

const authGate = document.querySelector("[data-auth-gate]");
const authenticatedContent = document.querySelectorAll("[data-authenticated-content]");
const supplyLocked = document.querySelector("[data-supply-locked]");
const authRequestForm = document.querySelector("[data-auth-request-form]");
const authVerifyForm = document.querySelector("[data-auth-verify-form]");
const authEmail = document.querySelector("[data-auth-email]");
const authCode = document.querySelector("[data-auth-code]");
const authTerms = document.querySelector("[data-auth-terms]");
const authAcceptTerms = document.querySelector("[data-auth-accept-terms]");
const authFeedback = document.querySelector("[data-auth-feedback]");
const authChallengeEmail = document.querySelector("[data-auth-challenge-email]");
const authModeTabs = document.querySelector("[data-auth-mode-tabs]");
const authTitlePrefix = document.querySelector("[data-auth-title-prefix]");
const authTitleAccent = document.querySelector("[data-auth-title-accent]");
const authDescription = document.querySelector("[data-auth-description]");
const authRequestLabel = document.querySelector("[data-auth-request-label]");
const authLoginButton = document.querySelector("[data-auth-login]");
const authOpenButtons = document.querySelectorAll("[data-auth-open]");
const authCloseButton = document.querySelector("[data-auth-close]");
const authLogoutButton = document.querySelector("[data-auth-logout]");
const status = document.querySelector("[data-registry-status]");

let authMode = "login";
let challenge;
let expiryTimer;
let dataRequest;
let dataRequestVersion = 0;
let authRequestVersion = 0;
let activeSession;
let authTrigger;
let restoreAuthTrigger = false;

const setFeedback = (message) => {
  if (authFeedback) authFeedback.textContent = message;
};

const validExpiry = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const validSession = (value) => value !== null
  && typeof value === "object"
  && typeof value.accessToken === "string"
  && value.accessToken.length > 0
  && value.accessToken.length <= 4_096
  && !/[\u0000-\u001f\u007f]/.test(value.accessToken)
  && typeof value.accountId === "string"
  && /^acct-[a-f0-9]{16}$/.test(value.accountId)
  && validExpiry(value.expiresAt)
  && Date.parse(value.expiresAt) > Date.now();

const setStatus = (state, label) => {
  if (!status) return;
  status.classList.remove("is-connecting", "is-live", "is-unavailable");
  status.classList.add(state);
  const labelElement = status.querySelector("[data-status-label]");
  if (labelElement) labelElement.textContent = label;
};

const stopDataRequest = () => {
  dataRequestVersion += 1;
  dataRequest?.abort();
  dataRequest = undefined;
};

const resetSupply = () => {
  const root = document.querySelector("[data-live-source]");
  root?.classList.remove("has-live-data", "has-data-error");
  for (const element of root?.querySelectorAll("[data-animate-number]") ?? []) {
    numberObserver?.unobserve(element);
    const card = element.closest(".metric-card");
    card?.classList.add("is-loading");
    card?.classList.remove("is-error");
    const skeleton = card?.querySelector("[data-metric-skeleton]");
    if (skeleton) skeleton.hidden = false;
    element.hidden = true;
    element.textContent = "—";
  }
  document.querySelector("[data-supply-region]")?.setAttribute("aria-busy", "true");
};

const openAuthDialog = (trigger) => {
  if (trigger) authTrigger = trigger;
  restoreAuthTrigger = true;
  if (!authGate.open) authGate.showModal();
  document.body.classList.add("is-auth-open");
  const target = authVerifyForm.hidden ? authEmail : authCode;
  target.focus({ preventScroll: true });
};

const closeAuthDialog = (restoreFocus = true) => {
  restoreAuthTrigger = restoreFocus;
  if (authGate.open) {
    authGate.close();
    return;
  }
  document.body.classList.remove("is-auth-open");
  if (!restoreFocus) authTrigger = undefined;
};

const showLogin = (message = "", revealGate = false) => {
  authRequestVersion += 1;
  stopDataRequest();
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
  activeSession = undefined;
  challenge = undefined;
  document.body.dataset.authState = "login";
  for (const section of authenticatedContent) section.hidden = true;
  supplyLocked.hidden = false;
  authRequestForm.hidden = false;
  authVerifyForm.hidden = true;
  authModeTabs.hidden = false;
  authLogoutButton.hidden = true;
  authLoginButton.hidden = false;
  status.hidden = true;
  resetSupply();
  setAuthMode("login");
  if (revealGate) openAuthDialog();
  else closeAuthDialog(false);
  setFeedback(message);
};

const scheduleExpiry = (session) => {
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  const expiresIn = Date.parse(session.expiresAt) - Date.now();
  if (expiresIn <= 0) {
    showLogin("Your session has expired. Sign in again.", true);
    return;
  }
  expiryTimer = window.setTimeout(() => {
    if (activeSession === undefined || Date.parse(activeSession.expiresAt) <= Date.now()) {
      showLogin("Your session has expired. Sign in again.", true);
      return;
    }
    scheduleExpiry(activeSession);
  }, Math.min(expiresIn, 2_147_483_647));
};

const renderAuthenticated = (session) => {
  activeSession = session;
  document.body.dataset.authState = "authenticated";
  closeAuthDialog(false);
  for (const section of authenticatedContent) section.hidden = false;
  supplyLocked.hidden = true;
  authLoginButton.hidden = true;
  authLogoutButton.hidden = false;
  status.hidden = false;
  setFeedback("");
  setStatus("is-connecting", "Connecting to Registry");
  resetSupply();
  scheduleExpiry(session);
};

const showVerification = () => {
  document.body.dataset.authState = "verify";
  authModeTabs.hidden = true;
  authRequestForm.hidden = true;
  authVerifyForm.hidden = false;
  authTitlePrefix.textContent = "Check your";
  authTitleAccent.textContent = "email.";
  authDescription.textContent = "Enter the six-digit code to open the live aggregate.";
  if (authChallengeEmail) authChallengeEmail.textContent = challenge.email;
  authCode.value = "";
  setFeedback("");
  authCode.focus();
};

const setAuthMode = (mode) => {
  if (authMode !== mode) {
    authRequestVersion += 1;
    challenge = undefined;
  }
  authMode = mode;
  authModeTabs.hidden = false;
  for (const button of document.querySelectorAll("[data-auth-mode]")) {
    const selected = button.dataset.authMode === mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  authTerms.hidden = mode !== "signup";
  authAcceptTerms.required = mode === "signup";
  authTitlePrefix.textContent = mode === "signup" ? "Create your" : "Sign in to";
  authTitleAccent.textContent = mode === "signup" ? "Marketplace account." : "live supply.";
  authDescription.textContent = mode === "signup"
    ? "Verify your email once to access the member aggregate."
    : "We will email a six-digit code. No password and no browser-stored session.";
  authRequestLabel.textContent = mode === "signup" ? "Create account" : "Send one-time code";
  setFeedback("");
};

const requestJson = async (endpoint, options = {}) => {
  const response = await fetch(`${registry}${endpoint}`, {
    ...options,
    cache: "no-store",
    headers: { accept: "application/json", ...(options.headers ?? {}) },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new TypeError("Invalid Registry response");
  }
  if (!response.ok) {
    const error = new Error("Registry request failed");
    error.status = response.status;
    throw error;
  }
  return body;
};

const requestChallenge = async (event) => {
  event.preventDefault();
  const requestVersion = ++authRequestVersion;
  const email = authEmail.value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setFeedback("Enter a valid email address.");
    authEmail.focus();
    return;
  }
  if (authMode === "signup" && !authAcceptTerms.checked) {
    setFeedback("Accept the terms to create an account.");
    authAcceptTerms.focus();
    return;
  }
  const submit = authRequestForm.querySelector("button[type=submit]");
  submit.disabled = true;
  setFeedback("");
  try {
    const body = await requestJson(authMode === "signup" ? "/v1/auth/signup" : "/v1/auth/login", {
      body: JSON.stringify(authMode === "signup" ? { email, acceptTerms: true } : { email }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (requestVersion !== authRequestVersion) return;
    if (
      body?.ok !== true
      || typeof body.challengeId !== "string"
      || !/^chal-[a-f0-9]{16}$/.test(body.challengeId)
      || !validExpiry(body.expiresAt)
    ) {
      throw new TypeError("Invalid Registry challenge");
    }
    challenge = { email, id: body.challengeId, expiresAt: body.expiresAt };
    showVerification();
  } catch {
    if (requestVersion === authRequestVersion) {
      setFeedback("Unable to start verification. Try again.");
    }
  } finally {
    if (requestVersion === authRequestVersion) submit.disabled = false;
  }
};

const verifyChallenge = async (event) => {
  event.preventDefault();
  const requestVersion = ++authRequestVersion;
  const code = authCode.value.trim();
  if (challenge === undefined || !/^\d{6}$/.test(code)) {
    setFeedback("Enter the six-digit verification code.");
    authCode.focus();
    return;
  }
  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    setAuthMode(authMode);
    authRequestForm.hidden = false;
    authVerifyForm.hidden = true;
    setFeedback("That verification code has expired. Start again.");
    return;
  }
  const submit = authVerifyForm.querySelector("button[type=submit]");
  submit.disabled = true;
  setFeedback("");
  try {
    const body = await requestJson("/v1/auth/verify", {
      body: JSON.stringify({ challengeId: challenge.id, code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (requestVersion !== authRequestVersion) return;
    const session = {
      accessToken: body?.accessToken,
      accountId: body?.accountId,
      expiresAt: body?.expiresAt,
    };
    if (body?.ok !== true || body?.tokenType !== "Bearer" || !validSession(session)) {
      throw new TypeError("Invalid Registry session");
    }
    renderAuthenticated(session);
    void loadLiveSupply(session);
    document.querySelector("#main-content")?.focus({ preventScroll: true });
  } catch {
    if (requestVersion === authRequestVersion) {
      setFeedback("Unable to verify that code. Try again.");
    }
  } finally {
    if (requestVersion === authRequestVersion) submit.disabled = false;
  }
};

const loadLiveSupply = async (session) => {
  const root = document.querySelector("[data-live-source]");
  if (!root) return;
  const requestVersion = ++dataRequestVersion;
  dataRequest = new AbortController();
  try {
    const response = await fetch(`${registry}/v1/marketplace/stats`, {
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${session.accessToken}` },
      redirect: "error",
      signal: dataRequest.signal,
    });
    if (requestVersion !== dataRequestVersion) return;
    if (response.status === 401) {
      showLogin("Your session is no longer valid. Sign in again.", true);
      return;
    }
    if (!response.ok) throw new Error("Registry stats unavailable");
    const stats = await response.json();
    const fields = [
      ["[data-session-count]", parseStat(stats.totalSessions), "integer"],
      ["[data-token-count]", parseStat(stats.tradeableTokens), "compact"],
      ["[data-runtime-count]", parseStat(stats.activeRuntimes), "integer"],
    ];
    for (const [selector, value, format] of fields) {
      const element = document.querySelector(selector);
      if (!element) continue;
      numberObserver?.unobserve(element);
      const card = element.closest(".metric-card");
      card?.classList.remove("is-loading", "is-error");
      const skeleton = card?.querySelector("[data-metric-skeleton]");
      if (skeleton) skeleton.hidden = true;
      element.hidden = false;
      element.dataset.value = String(value);
      element.dataset.format = format;
      element.textContent = formatValue(value, format);
      if (numberObserver) numberObserver.observe(element);
      else animateNumber(element);
    }
    setStatus("is-live", "Registry connected");
    document.querySelector("[data-supply-region]")?.setAttribute("aria-busy", "false");
    const announcement = document.querySelector("[data-supply-announcement]");
    if (announcement) {
      announcement.textContent = `Live supply: ${formatInteger(stats.totalSessions)} uploaded sessions, ${formatCompact(stats.tradeableTokens)} training tokens, and ${formatInteger(stats.activeRuntimes)} active runtimes.`;
    }
    root.classList.add("has-live-data");
  } catch (error) {
    if (requestVersion !== dataRequestVersion || error?.name === "AbortError") return;
    setStatus("is-unavailable", "Registry unavailable");
    for (const element of root.querySelectorAll("[data-animate-number]")) {
      numberObserver?.unobserve(element);
      const card = element.closest(".metric-card");
      card?.classList.remove("is-loading");
      card?.classList.add("is-error");
      const skeleton = card?.querySelector("[data-metric-skeleton]");
      if (skeleton) skeleton.hidden = true;
      element.hidden = false;
      element.textContent = "—";
    }
    document.querySelector("[data-supply-region]")?.setAttribute("aria-busy", "false");
    const announcement = document.querySelector("[data-supply-announcement]");
    if (announcement) announcement.textContent = "Live supply unavailable.";
    root.classList.add("has-data-error");
  } finally {
    if (requestVersion === dataRequestVersion) dataRequest = undefined;
  }
};

const logout = async () => {
  const session = activeSession;
  if (session === undefined) {
    showLogin();
    return;
  }
  authLogoutButton.disabled = true;
  setFeedback("");
  try {
    const response = await fetch(`${registry}/v1/auth/logout`, {
      body: "{}",
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 401) throw new Error("Registry logout failed");
    showLogin("You have been signed out.", true);
  } catch {
    setFeedback("Unable to log out. Try again.");
    setStatus("is-unavailable", "Logout failed");
  } finally {
    authLogoutButton.disabled = false;
  }
};

for (const button of document.querySelectorAll("[data-auth-mode]")) {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
}
authRequestForm.addEventListener("submit", requestChallenge);
authVerifyForm.addEventListener("submit", verifyChallenge);
document.querySelector("[data-auth-restart]").addEventListener("click", () => {
  authRequestVersion += 1;
  challenge = undefined;
  authModeTabs.hidden = false;
  authRequestForm.hidden = false;
  authVerifyForm.hidden = true;
  setAuthMode(authMode);
  setFeedback("");
  authEmail.focus();
});
for (const button of authOpenButtons) {
  button.addEventListener("click", () => openAuthDialog(button));
}
authCloseButton.addEventListener("click", () => closeAuthDialog());
authGate.addEventListener("click", (event) => {
  if (event.target === authGate) closeAuthDialog();
});
authGate.addEventListener("cancel", () => {
  restoreAuthTrigger = true;
});
authGate.addEventListener("close", () => {
  document.body.classList.remove("is-auth-open");
  const trigger = authTrigger;
  authTrigger = undefined;
  if (restoreAuthTrigger && trigger?.isConnected && !trigger.hidden) {
    trigger.focus({ preventScroll: true });
  }
  restoreAuthTrigger = false;
});
authLogoutButton.addEventListener("click", () => void logout());

for (const element of document.querySelectorAll("[data-reveal]")) {
  if (reduceMotion.matches || !revealObserver) element.classList.add("is-visible");
  else revealObserver.observe(element);
}

document.body.classList.remove("no-js");
setAuthMode("login");
showLogin();
