const registry = "https://gateway.getatm.io";

const fmtInt = (value) => Math.round(value).toLocaleString("en-US");
const fmtCompact = (value) =>
  value >= 1e9 ? `${(value / 1e9).toFixed(2)}B`
    : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M`
      : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K`
        : fmtInt(value);

const numeric = (candidate) => {
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const loadSupply = async () => {
  const status = document.querySelector('[data-testid="aggregate-status"]');
  try {
    const response = await fetch(`${registry}/v1/marketplace/stats`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("aggregate stats unavailable");

    const stats = await response.json();
    document.querySelector('[data-testid="aggregate-session-count"]').textContent =
      fmtInt(numeric(stats.totalSessions));
    document.querySelector('[data-testid="aggregate-token-count"]').textContent =
      fmtCompact(numeric(stats.tradeableTokens));
    document.querySelector('[data-testid="aggregate-runtime-count"]').textContent =
      fmtInt(numeric(stats.activeRuntimes));
    status.textContent = "Live from Registry";
    status.classList.add("is-live");
  } catch {
    status.textContent = "Registry temporarily unavailable";
    status.classList.add("is-unavailable");
  }
};

if (document.querySelector("#main-legacy")) void loadSupply();
