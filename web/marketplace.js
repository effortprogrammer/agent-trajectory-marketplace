const registry = "https://gateway.getatm.io";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)");

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

for (const element of document.querySelectorAll("[data-animate-number]")) {
  if (numberObserver) numberObserver.observe(element);
  else animateNumber(element);
}

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.16 })
  : null;

for (const element of document.querySelectorAll("[data-reveal]")) {
  if (reduceMotion.matches || !revealObserver) element.classList.add("is-visible");
  else revealObserver.observe(element);
}

const nav = document.querySelector("[data-marketplace-nav]");
const updateNavigation = () => nav?.classList.toggle("is-compact", window.scrollY > 24);
updateNavigation();
window.addEventListener("scroll", updateNavigation, { passive: true });

if (hoverCapable.matches && !reduceMotion.matches) {
  for (const surface of document.querySelectorAll("[data-tilt]")) {
    surface.addEventListener("pointermove", (event) => {
      const bounds = surface.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const rotateX = (0.5 - y) * 10;
      const rotateY = (x - 0.5) * 10;
      surface.style.setProperty("--glare-x", `${x * 100}%`);
      surface.style.setProperty("--glare-y", `${y * 100}%`);
      surface.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    surface.addEventListener("pointerleave", () => {
      surface.style.removeProperty("transform");
      surface.style.setProperty("--glare-x", "50%");
      surface.style.setProperty("--glare-y", "50%");
    });
  }
}

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

const loadLiveSupply = async () => {
  const root = document.querySelector("[data-live-source]");
  if (!root) return;
  const status = document.querySelector("[data-registry-status]");
  try {
    const response = await fetch(`${registry}/v1/marketplace/stats`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
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
    status?.classList.remove("is-connecting", "is-unavailable");
    status?.classList.add("is-live");
    const statusLabel = status?.querySelector("[data-status-label]");
    if (statusLabel) statusLabel.textContent = "Registry connected";
    const supplyRegion = document.querySelector("[data-supply-region]");
    supplyRegion?.setAttribute("aria-busy", "false");
    const announcement = document.querySelector("[data-supply-announcement]");
    if (announcement) {
      announcement.textContent = `Live supply: ${formatInteger(stats.totalSessions)} uploaded sessions, ${formatCompact(stats.tradeableTokens)} training tokens, and ${formatInteger(stats.activeRuntimes)} active runtimes.`;
    }
    root.classList.add("has-live-data");
  } catch {
    status?.classList.remove("is-connecting", "is-live");
    status?.classList.add("is-unavailable");
    const statusLabel = status?.querySelector("[data-status-label]");
    if (statusLabel) statusLabel.textContent = "Registry unavailable";
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
    const supplyRegion = document.querySelector("[data-supply-region]");
    supplyRegion?.setAttribute("aria-busy", "false");
    const announcement = document.querySelector("[data-supply-announcement]");
    if (announcement) announcement.textContent = "Live supply unavailable.";
    root.classList.add("has-data-error");
  }
};

document.body.classList.remove("no-js");
void loadLiveSupply();
