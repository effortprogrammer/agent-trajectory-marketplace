import { mountSellerConsole } from "./console.3f1a15976cfe523406f7d64437ff71d73596ae390c2f96bce09844fb63d36445.js";
import { mountPublicPayoutCapacity } from "./public-payout-capacity.116ac52e91e83dbdb27f8bf3ec9bab30dea614989f48e9bcbe9a3d9efe504d9a.js";

const localPreview = location.hostname === "127.0.0.1" || location.hostname === "localhost" ||
  location.hostname === "[::1]";
const registry = localPreview ? "/api/registry" : "https://gateway.getatm.io";
const publicStatsEndpoint = localPreview
  ? "/api/public-stats"
  : `${registry}/v1/marketplace/public-stats`;
const publicPayoutCapacityEndpoint = localPreview
  ? "/api/registry/v1/marketplace/public-payout-capacity"
  : `${registry}/v1/marketplace/public-payout-capacity`;
const waitlistAcknowledgmentKey = "atm.marketplace.waitlist-ack-v1";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const numeric = (candidate) => {
  const value = Number(candidate);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

const parseStat = (candidate) => {
  if (
    typeof candidate !== "number"
    || !Number.isSafeInteger(candidate)
    || candidate < 0
  ) {
    throw new TypeError("Invalid aggregate statistic");
  }
  return candidate;
};

const parsePublicTokenTotal = (candidate) => {
  if (typeof candidate === "string" && /^(0|[1-9][0-9]*)$/.test(candidate)) {
    return BigInt(candidate);
  }
  if (
    typeof candidate === "number"
    && Number.isSafeInteger(candidate)
    && candidate >= 0
  ) {
    return BigInt(candidate);
  }
  throw new TypeError("Invalid public token statistic");
};

const formatInteger = (value) =>
  (typeof value === "bigint" ? value : Math.round(value)).toLocaleString("en-US");

const renderPublicTokenTotal = (value) => {
  if (!publicTokenCount) return;
  const formatted = formatInteger(value);
  const [first, ...rest] = formatted.split(",");
  const nodes = [document.createTextNode(first)];
  for (const group of rest) {
    nodes.push(document.createTextNode(","));
    nodes.push(document.createElement("wbr"));
    nodes.push(document.createTextNode(group));
  }
  publicTokenCount.replaceChildren(...nodes);
  publicTokenCount.setAttribute("aria-label", formatted);
};
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
const navMenuToggle = document.querySelector("[data-nav-menu-toggle]");
const navMobile = window.matchMedia("(max-width: 960px)");
const closeNavigation = (restoreFocus = false) => {
  document.body.classList.remove("is-nav-open");
  navMenuToggle?.setAttribute("aria-expanded", "false");
  navMenuToggle?.setAttribute("aria-label", "Open navigation");
  if (restoreFocus) navMenuToggle?.focus({ preventScroll: true });
};
navMenuToggle?.addEventListener("click", () => {
  const open = !document.body.classList.contains("is-nav-open");
  document.body.classList.toggle("is-nav-open", open);
  navMenuToggle.setAttribute("aria-expanded", String(open));
  navMenuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});
for (const link of document.querySelectorAll(".nav-links a")) {
  link.addEventListener("click", () => closeNavigation());
}
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !document.body.classList.contains("is-nav-open")) return;
  event.preventDefault();
  closeNavigation(true);
});
navMobile.addEventListener("change", (event) => {
  if (!event.matches) closeNavigation();
});
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
      button.dataset.copyState = "copied";
      if (status) status.textContent = "Copied to clipboard";
    } catch {
      button.textContent = "Unavailable";
      button.dataset.copyState = "unavailable";
      if (status) status.textContent = "Clipboard access unavailable";
    }
    button.addEventListener("blur", () => {
      button.textContent = "Copy";
      button.dataset.copyState = "idle";
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
const authContactConsent = document.querySelector("[data-auth-contact-consent]");
const authAcceptContact = document.querySelector("[data-auth-accept-contact]");
const authSignupTerms = document.querySelector("[data-auth-signup-terms]");
const authAcceptTerms = document.querySelector("[data-auth-accept-terms]");
const authModeSignup = document.querySelector("[data-auth-mode-signup]");
const authModeLogin = document.querySelector("[data-auth-mode-login]");
const authWaitlistSuccess = document.querySelector("[data-auth-waitlist-success]");
const authFeedback = document.querySelector("[data-auth-feedback]");
const authChallengeEmail = document.querySelector("[data-auth-challenge-email]");
const authConsolePath = document.querySelector("[data-auth-console-path]");
const authKicker = document.querySelector("[data-auth-kicker]");
const authTitlePrefix = document.querySelector("[data-auth-title-prefix]");
const authTitleAccent = document.querySelector("[data-auth-title-accent]");
const authDescription = document.querySelector("[data-auth-description]");
const authRequestLabel = document.querySelector("[data-auth-request-label]");
const authAccessButton = document.querySelector("[data-testid=request-access-button]");
const authOpenButtons = document.querySelectorAll("[data-auth-open]");
const authLoginButtons = document.querySelectorAll("[data-auth-login-open]");
const authCloseButton = document.querySelector("[data-auth-close]");
const authLogoutButton = document.querySelector("[data-auth-logout]");
const status = document.querySelector("[data-registry-status]");
const publicTokenRegion = document.querySelector("[data-public-token-region]");
const publicTokenCount = document.querySelector("[data-public-token-count]");
const publicTokenSkeleton = document.querySelector("[data-public-token-skeleton]");
const publicTokenNote = document.querySelector("[data-public-token-note]");
const consoleLink = document.querySelector("[data-console-link]");
const consoleView = document.querySelector("[data-console-view]");

let authMode = "waitlist";
let challenge;
let expiryTimer;
let dataRequest;
let dataRequestVersion = 0;
let authRequestVersion = 0;
let sellerConsoleRequestVersion = 0;
let activeSession;
let authTrigger;
let restoreAuthTrigger = false;

const setFeedback = (message, errorCode = "") => {
  if (!authFeedback) return;
  authFeedback.textContent = message;
  if (errorCode === "") {
    delete authFeedback.dataset.errorCode;
  } else {
    authFeedback.dataset.errorCode = errorCode;
  }
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
  const target = !authWaitlistSuccess.hidden
    ? authWaitlistSuccess
    : authVerifyForm.hidden
      ? authEmail
      : authCode;
  target.focus({ preventScroll: true });
};

const hasWaitlistAcknowledgment = () => {
  try {
    return window.sessionStorage.getItem(waitlistAcknowledgmentKey) === "1";
  } catch {
    return false;
  }
};

const rememberWaitlistAcknowledgment = () => {
  try {
    window.sessionStorage.setItem(waitlistAcknowledgmentKey, "1");
  } catch {
    // The current dialog still keeps the acknowledgment visible.
  }
};

const invalidateAuthRequest = () => {
  authRequestVersion += 1;
  authRequestForm.querySelector("button[type=submit]").disabled = false;
  authVerifyForm.querySelector("button[type=submit]").disabled = false;
};

const closeAuthDialog = (restoreFocus = true) => {
  restoreAuthTrigger = restoreFocus;
  if (restoreFocus) invalidateAuthRequest();
  if (authGate.open) {
    authGate.close();
    return;
  }
  document.body.classList.remove("is-auth-open");
  if (!restoreFocus) authTrigger = undefined;
};

const showPublicAccess = (message = "", revealGate = false) => {
  authRequestVersion += 1;
  stopDataRequest();
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
  activeSession = undefined;
  challenge = undefined;
  document.body.dataset.authState = "waitlist";
  for (const section of authenticatedContent) section.hidden = true;
  supplyLocked.hidden = false;
  authRequestForm.hidden = false;
  authVerifyForm.hidden = true;
  authWaitlistSuccess.hidden = true;
  authLogoutButton.hidden = true;
  authAccessButton.hidden = false;
  for (const button of authLoginButtons) button.hidden = false;
  consoleLink.hidden = true;
  consoleView.hidden = true;
  document.body.classList.remove("is-console-view");
  status.hidden = true;
  resetSupply();
  setAuthMode("waitlist");
  if (revealGate) openAuthDialog();
  else closeAuthDialog(false);
  setFeedback(message);
};

const showSignIn = (message) => {
  showPublicAccess();
  setAuthMode("login");
  openAuthDialog();
  setFeedback(message);
};

const scheduleExpiry = (session) => {
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  const expiresIn = Date.parse(session.expiresAt) - Date.now();
  if (expiresIn <= 0) {
    showSignIn("Your session has expired. Sign in to continue.");
    return;
  }
  expiryTimer = window.setTimeout(() => {
    if (activeSession === undefined || Date.parse(activeSession.expiresAt) <= Date.now()) {
      showSignIn("Your session has expired. Sign in to continue.");
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
  authAccessButton.hidden = true;
  for (const button of authLoginButtons) button.hidden = true;
  authLogoutButton.hidden = false;
  consoleLink.hidden = false;
  status.hidden = true;
  setFeedback("");
  setStatus("is-connecting", "Connecting to Registry");
  resetSupply();
  scheduleExpiry(session);
  if (window.location.hash === "#console") void showConsole(session);
};

const loadPublicTokenTotal = async () => {
  if (!publicTokenRegion || !publicTokenCount || !publicTokenSkeleton) return;
  try {
    const response = await fetch(publicStatsEndpoint, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Registry public stats unavailable");
    const stats = await response.json();
    const tokens = parsePublicTokenTotal(stats.tradeableTokens);
    renderPublicTokenTotal(tokens);
    publicTokenCount.hidden = false;
    publicTokenSkeleton.hidden = true;
    if (publicTokenNote) publicTokenNote.hidden = false;
    publicTokenRegion.classList.remove("is-loading", "is-error");
    publicTokenRegion.setAttribute("aria-busy", "false");
  } catch {
    publicTokenCount.textContent = "Unavailable";
    publicTokenCount.removeAttribute("aria-label");
    publicTokenCount.hidden = false;
    publicTokenSkeleton.hidden = true;
    if (publicTokenNote) publicTokenNote.hidden = true;
    publicTokenRegion.classList.remove("is-loading");
    publicTokenRegion.classList.add("is-error");
    publicTokenRegion.setAttribute("aria-busy", "false");
  }
};

const showVerification = () => {
  document.body.dataset.authState = "verify";
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
  if (mode === "login" || mode === "signup") {
    authEmail.value = authEmail.value.trim().toLowerCase();
  }
  authMode = mode;
  document.body.dataset.authState = mode;
  authRequestForm.hidden = false;
  authVerifyForm.hidden = true;
  authWaitlistSuccess.hidden = true;
  const isWaitlist = mode === "waitlist";
  const isSignup = mode === "signup";
  authContactConsent.hidden = !isWaitlist;
  authAcceptContact.required = isWaitlist;
  authSignupTerms.hidden = !isSignup;
  authAcceptTerms.required = isSignup;
  if (isSignup) authAcceptTerms.checked = false;
  authModeSignup.hidden = mode !== "login";
  authModeLogin.hidden = !isSignup;
  authConsolePath.textContent = isWaitlist
    ? "ATM / buyer-access"
    : isSignup ? "ATM / member-sign-up" : "ATM / member-sign-in";
  authKicker.textContent = isWaitlist ? "Buyer access" : isSignup ? "New member" : "Existing member";
  authTitlePrefix.textContent = isWaitlist ? "Request" : isSignup ? "Create your" : "Member sign in to";
  authTitleAccent.textContent = isWaitlist ? "buyer access." : isSignup ? "ATM account." : "live supply.";
  authDescription.textContent = isWaitlist
    ? "For teams looking to license agent-session datasets. We will only contact you about this buyer access request."
    : isSignup
      ? "Enter your email to receive a six-digit code. No password and no browser-stored session."
      : "We will email a six-digit code. No password and no browser-stored session.";
  authRequestLabel.textContent = isWaitlist ? "Request buyer access" : isSignup ? "Create account" : "Send one-time code";
  authRequestForm.querySelector("button[type=submit]").disabled = false;
  if (isWaitlist && hasWaitlistAcknowledgment()) {
    authRequestForm.hidden = true;
    authWaitlistSuccess.hidden = false;
  }
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
    const code = body?.ok === false ? body?.error?.code : undefined;
    error.code = code === "account_required" || code === "weekly_payout_limit_reached"
      ? code
      : undefined;
    const retryAfter = response.headers.get("retry-after");
    error.retryAfterSeconds = retryAfter !== null && /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : undefined;
    throw error;
  }
  return body;
};

const showConsole = async (session = activeSession) => {
  if (session === undefined) return;
  const requestVersion = ++sellerConsoleRequestVersion;
  const isCurrent = () => (
    sellerConsoleRequestVersion === requestVersion
    && activeSession === session
    && window.location.hash === "#console"
  );
  document.body.classList.add("is-console-view");
  consoleView.hidden = false;
  try {
    if (!isCurrent()) return;
    await mountSellerConsole({
      isCurrent,
      requestJson,
      session,
      showLogin: () => showSignIn("Your session is no longer valid. Sign in to continue."),
    });
  } catch {
    if (!isCurrent()) return;
    const state = consoleView.querySelector("[data-console-state]");
    if (state) {
      state.hidden = false;
      state.dataset.state = "error";
      state.textContent = "Seller sales are unavailable. Try again shortly.";
    }
  }
};

const closeConsole = () => {
  sellerConsoleRequestVersion += 1;
  document.body.classList.remove("is-console-view");
  consoleView.hidden = true;
};

const validEmail = (email) => /^\S+@\S+\.\S+$/.test(email);

const requestWaitlist = async (event) => {
  event.preventDefault();
  const requestVersion = ++authRequestVersion;
  const email = authEmail.value.trim().toLowerCase();
  if (email.length > 320 || !validEmail(email)) {
    setFeedback("Enter a valid email address.");
    authEmail.focus();
    return;
  }
  if (!authAcceptContact.checked) {
    setFeedback("Consent is required to request buyer access.");
    authAcceptContact.focus();
    return;
  }
  const submit = authRequestForm.querySelector("button[type=submit]");
  submit.disabled = true;
  setFeedback("");
  try {
    const response = await fetch("/api/waitlist", {
      body: JSON.stringify({ email, acceptContact: true }),
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new TypeError("Invalid Registry waitlist response");
    }
    if (
      response.status !== 202
      || body?.ok !== true
      || body.status !== "accepted"
    ) {
      throw new Error("Registry waitlist request failed");
    }
    if (requestVersion !== authRequestVersion) return;
    rememberWaitlistAcknowledgment();
    authRequestForm.hidden = true;
    authWaitlistSuccess.hidden = false;
    authWaitlistSuccess.focus({ preventScroll: true });
  } catch {
    if (requestVersion === authRequestVersion) {
      setFeedback("We couldn’t request buyer access. Check your connection and try again.");
    }
  } finally {
    if (requestVersion === authRequestVersion) submit.disabled = false;
  }
};

const requestChallenge = async (event) => {
  event.preventDefault();
  const requestVersion = ++authRequestVersion;
  const email = authEmail.value.trim().toLowerCase();
  if (email.length > 320 || !validEmail(email)) {
    setFeedback("Enter a valid email address.", "invalid_email");
    authEmail.focus();
    return;
  }
  if (authMode === "signup" && !authAcceptTerms.checked) {
    setFeedback("Accept the terms to create an account.", "terms_required");
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

const requestAccess = (event) => authMode === "waitlist"
  ? requestWaitlist(event)
  : requestChallenge(event);

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
  } catch (error) {
    if (requestVersion === authRequestVersion) {
      if (error instanceof Error && error.code === "account_required") {
        setFeedback(
          "No member account exists for this email. Sign up to create one, request buyer access, or use your member email.",
          "account_required",
        );
      } else {
        setFeedback("Unable to verify that code. Try again.");
      }
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
      showSignIn("Your session is no longer valid. Sign in to continue.");
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
    showPublicAccess();
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
    showSignIn("You have been signed out.");
  } catch {
    setFeedback("Unable to log out. Try again.");
    setStatus("is-unavailable", "Logout failed");
  } finally {
    authLogoutButton.disabled = false;
  }
};

authRequestForm.addEventListener("submit", requestAccess);
authVerifyForm.addEventListener("submit", verifyChallenge);
document.querySelector("[data-auth-restart]").addEventListener("click", () => {
  authRequestVersion += 1;
  challenge = undefined;
  authRequestForm.hidden = false;
  authVerifyForm.hidden = true;
  setAuthMode(authMode);
  setFeedback("");
  authEmail.focus();
});
authModeSignup.addEventListener("click", () => {
  setAuthMode("signup");
  authEmail.focus();
});
authModeLogin.addEventListener("click", () => {
  setAuthMode("login");
  authEmail.focus();
});
for (const button of authOpenButtons) {
  button.addEventListener("click", () => {
    closeNavigation();
    setAuthMode("waitlist");
    openAuthDialog(button);
  });
}
for (const button of authLoginButtons) {
  button.addEventListener("click", () => {
    closeNavigation();
    setAuthMode("login");
    openAuthDialog(button);
  });
}
authCloseButton.addEventListener("click", () => closeAuthDialog());
authGate.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...authGate.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((element) =>
    !element.hasAttribute("disabled")
    && !element.closest("[hidden]")
    && element.getClientRects().length > 0,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
authGate.addEventListener("click", (event) => {
  if (event.target === authGate) closeAuthDialog();
});
authGate.addEventListener("cancel", () => {
  restoreAuthTrigger = true;
  invalidateAuthRequest();
});
authGate.addEventListener("close", () => {
  document.body.classList.remove("is-auth-open");
  const trigger = authTrigger;
  authTrigger = undefined;
  const mobileNavigationTrigger = navMobile.matches && trigger?.closest("[data-marketplace-nav]");
  const focusTarget = mobileNavigationTrigger ? navMenuToggle : trigger;
  if (
    restoreAuthTrigger
    && focusTarget?.isConnected
    && !focusTarget.hidden
    && focusTarget.getClientRects().length > 0
  ) {
    focusTarget.focus({ preventScroll: true });
  }
  restoreAuthTrigger = false;
});
authLogoutButton.addEventListener("click", () => void logout());
window.addEventListener("hashchange", () => {
  if (window.location.hash === "#console" && activeSession !== undefined) {
    closeNavigation();
    void showConsole();
  } else {
    closeConsole();
  }
});

for (const element of document.querySelectorAll("[data-reveal]")) {
  if (reduceMotion.matches || !revealObserver) element.classList.add("is-visible");
  else revealObserver.observe(element);
}

document.body.classList.remove("no-js");
setAuthMode("waitlist");
showPublicAccess();
void loadPublicTokenTotal();
void mountPublicPayoutCapacity(publicPayoutCapacityEndpoint);
