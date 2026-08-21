import { parseEarningsResponse, parseSessionsResponse } from "./console-contract.js";

const formatCredits = (value) => `${value.toLocaleString("en-US")} credits`;
const shortId = (id) => id.slice(0, 8);
const dateLabel = (value) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value));
const element = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgElement = (name, attributes) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

const renderChart = (root, earnings) => {
  root.replaceChildren();
  if (earnings.points.length === 0) {
    root.append(element("p", "seller-console-state", "No earnings recorded in this window."));
    return;
  }
  const width = 720; const height = 220; const pad = { bottom: 28, left: 48, right: 16, top: 16 };
  const values = earnings.points.map((point) => point.cumulativeNetCredits);
  const max = Math.max(...values, earnings.openingCumulativeCredits, 1) * 1.15;
  const x = (index) => pad.left + (earnings.points.length === 1 ? 0 : index / (earnings.points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const svg = svgElement("svg", { "aria-label": "Cumulative earnings over the last 30 days", role: "img", viewBox: `0 0 ${width} ${height}` });
  for (const fraction of [0, .5, 1]) {
    const gridY = y(max * fraction);
    svg.append(svgElement("line", { class: "seller-chart-grid", x1: pad.left, x2: width - pad.right, y1: gridY, y2: gridY }));
    const label = svgElement("text", { class: "seller-chart-label", "text-anchor": "end", x: pad.left - 8, y: gridY + 3 });
    label.textContent = formatCredits(Math.round(max * fraction)); svg.append(label);
  }
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(values.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  svg.append(svgElement("path", { class: "seller-chart-area", d: area }));
  svg.append(svgElement("path", { class: "seller-chart-line", d: path }));
  svg.append(svgElement("circle", { class: "seller-chart-dot", cx: x(values.length - 1), cy: y(values.at(-1)), r: 3.5 }));
  for (const index of [...new Set([0, Math.floor(values.length / 2), values.length - 1])]) {
    const anchor = index === 0 ? "start" : index === values.length - 1 ? "end" : "middle";
    const label = svgElement("text", { class: "seller-chart-label", "text-anchor": anchor, x: index === 0 ? pad.left : index === values.length - 1 ? width - pad.right : x(index), y: height - 8 });
    label.textContent = dateLabel(earnings.points[index].periodStart); svg.append(label);
  }
  root.append(svg);
};

const renderSessions = (root, sessions) => {
  root.replaceChildren();
  if (sessions.length === 0) { root.append(element("li", "seller-console-state", "No seller sessions yet.")); return; }
  const max = Math.max(...sessions.map((session) => session.earnedCredits ?? 0), 0);
  for (const session of sessions) {
    const item = element("li"); const row = element("div", "seller-performance-row"); const top = element("div", "seller-performance-top");
    top.append(element("span", "seller-session-label", `${session.datasetId} / ${shortId(session.sessionId)}`));
    if (session.earnedCredits !== null) top.append(element("span", "seller-amount", formatCredits(session.earnedCredits)));
    const pill = element("span", "seller-status-pill", session.saleStatus.stage.replaceAll("_", " "));
    pill.dataset.stage = session.saleStatus.stage;
    top.append(pill);
    row.append(top);
    if (session.earnedCredits !== null && max > 0) { const bar = element("div", "seller-performance-bar"); const fill = element("i"); fill.style.width = `${(session.earnedCredits / max) * 100}%`; bar.append(fill); row.append(bar); }
    row.append(element("p", "seller-performance-meta", `${session.saleStatus.stage.replaceAll("_", " ")} - updated ${dateLabel(session.saleStatus.changedAt)}`)); item.append(row); root.append(item);
  }
};

export const mountSellerConsole = async ({ requestJson, session, showLogin }) => {
  const view = document.querySelector("[data-console-view]");
  if (!view) return;
  const announcement = view.querySelector("[data-console-announcement]");
  const state = view.querySelector("[data-console-state]");
  const chart = view.querySelector("[data-console-chart]");
  const sessions = view.querySelector("[data-console-sessions]");
  const seller = view.querySelector("[data-console-seller]");
  const total = view.querySelector("[data-console-total]");
  const today = new Date(); const from = new Date(today); from.setUTCDate(from.getUTCDate() - 30);
  const day = (value) => value.toISOString().slice(0, 10);
  const headers = { authorization: `Bearer ${session.accessToken}` };
  state.hidden = false; state.dataset.state = "loading"; state.textContent = "Loading seller sales...";
  chart.replaceChildren(element("div", "seller-console-skeleton")); sessions.replaceChildren();
  try {
    const [me, sessionsBody, earningsBody] = await Promise.all([
      requestJson("/v1/auth/me", { headers }),
      requestJson("/v1/marketplace/seller/sales/sessions", { headers }),
      requestJson(`/v1/marketplace/seller/sales/earnings?from=${day(from)}&to=${day(today)}&interval=day`, { headers }),
    ]);
    if (me?.ok !== true || typeof me.account?.accountId !== "string") throw new TypeError("Invalid Registry account response");
    const validatedSessions = parseSessionsResponse(sessionsBody); const earnings = parseEarningsResponse(earningsBody);
    seller.textContent = me.account.accountId; total.textContent = `${formatCredits(earnings.points.at(-1)?.cumulativeNetCredits ?? earnings.openingCumulativeCredits)} cumulative`;
    renderChart(chart, earnings); renderSessions(sessions, validatedSessions.sessions);
    state.hidden = true; announcement.textContent = `Seller console loaded: ${validatedSessions.sessions.length} sessions.`;
  } catch (error) {
    if (error?.status === 401) { showLogin(); return; }
    state.hidden = false; state.dataset.state = "error"; state.textContent = "Seller sales are unavailable. Try again shortly."; announcement.textContent = "Seller console could not load.";
  }
};
