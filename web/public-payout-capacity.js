export class PublicPayoutCapacityContractError extends TypeError {}

const fail = () => {
  throw new PublicPayoutCapacityContractError(
    "Invalid public payout capacity response",
  );
};

const exactKeys = (value, expected) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    fail();
  }
};

export const parsePublicPayoutCapacity = (value) => {
  exactKeys(value, ["ok", "payoutCapacity"]);
  if (value.ok !== true) fail();
  const capacity = value.payoutCapacity;
  exactKeys(capacity, [
    "currency",
    "limitMinor",
    "payoutRemainingMinor",
    "scope",
    "windowSeconds",
  ]);
  if (
    capacity.scope !== "platform"
    || capacity.currency !== "USD"
    || capacity.limitMinor !== 20_000
    || capacity.windowSeconds !== 604_800
    || !Number.isSafeInteger(capacity.payoutRemainingMinor)
    || capacity.payoutRemainingMinor < 0
    || capacity.payoutRemainingMinor > capacity.limitMinor
  ) {
    fail();
  }
  return capacity;
};

const usd = (minor) => new Intl.NumberFormat("en-US", {
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  style: "currency",
}).format(minor / 100);

export const mountPublicPayoutCapacity = async (endpoint) => {
  const region = document.querySelector("[data-public-payout-region]");
  const value = document.querySelector("[data-public-payout-remaining]");
  const skeleton = document.querySelector("[data-public-payout-skeleton]");
  const note = document.querySelector("[data-public-payout-note]");
  if (!region || !value || !skeleton) return;
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Registry payout capacity unavailable");
    const capacity = parsePublicPayoutCapacity(await response.json());
    const amount = usd(capacity.payoutRemainingMinor);
    value.textContent = amount;
    value.setAttribute(
      "aria-label",
      `${amount} of ${usd(capacity.limitMinor)} weekly payout capacity`,
    );
    value.hidden = false;
    skeleton.hidden = true;
    if (note) note.hidden = false;
    region.classList.remove("is-loading", "is-error");
    region.setAttribute("aria-busy", "false");
  } catch {
    value.textContent = "Unavailable";
    value.removeAttribute("aria-label");
    value.hidden = false;
    skeleton.hidden = true;
    if (note) note.hidden = true;
    region.classList.remove("is-loading");
    region.classList.add("is-error");
    region.setAttribute("aria-busy", "false");
  }
};
