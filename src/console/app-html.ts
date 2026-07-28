export const consoleAppHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Trajectory Console</title>
<style>
:root {
  --surface: #ffffff; --canvas: #f7f8fa; --line: #e6e8ec;
  --ink: #0d1117; --ink-2: #5b6472; --ink-3: #8b94a3;
  --blue: #1f4fd8; --teal: #17a08a; --pink: #d81f6a; --amber: #b7791f;
  --radius: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--canvas); color: var(--ink);
  font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.mono { font-family: "SF Mono", "JetBrains Mono", Menlo, monospace; }
.layout { display: flex; min-height: 100vh; }
.rail {
  width: 56px; flex: 0 0 56px; background: var(--canvas);
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 0;
}
.rail button {
  width: 36px; height: 36px; border: 0; border-radius: 9px; background: transparent;
  color: var(--ink-3); cursor: pointer; font-size: 15px;
}
.rail button:hover { background: #eceef2; color: var(--ink-2); }
.rail button[aria-current="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(13,17,23,.08); }
.panel { flex: 1; margin: 10px 10px 10px 0; background: var(--surface); border-radius: var(--radius); border: 1px solid var(--line); overflow: hidden; }
.topbar { padding: 18px 26px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 12px; }
.topbar h1 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.root-chip { margin-left: auto; font-size: 12px; color: var(--ink-3); max-width: 46ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { padding: 26px; }
.tabs { display: flex; gap: 4px; margin-bottom: 26px; }
.tabs button {
  border: 0; background: transparent; color: var(--ink-2); cursor: pointer;
  padding: 8px 15px; border-radius: 999px; font-size: 14px; font-weight: 550;
}
.tabs button:hover { color: var(--ink); }
.tabs button[aria-selected="true"] { background: #eef0f4; color: var(--ink); }
.kpis { display: flex; gap: 52px; flex-wrap: wrap; margin-bottom: 26px; }
.kpi-value { font-size: 40px; font-weight: 680; letter-spacing: -.03em; line-height: 1.1; }
.kpi-label { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink-2); margin-top: 4px; }
.kpi-label i { width: 3px; height: 13px; border-radius: 2px; background: var(--blue); display: inline-block; }
.kpi-label.teal i { background: var(--teal); } .kpi-label.pink i { background: var(--pink); }
.chart { display: flex; align-items: flex-end; gap: 10px; height: 130px; margin-bottom: 30px; }
.chart .col { flex: 0 0 26px; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
.chart .seg { border-radius: 3px 3px 0 0; }
.chart .seg.safe { background: var(--teal); } .chart .seg.filtered { background: var(--pink); }
.chart .cap { font-size: 10px; color: var(--ink-3); text-align: center; margin-top: 6px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.sessions col.pick { width: 40px; }
table.sessions col.meta { width: 108px; }
table.sessions col.small { width: 74px; }
table.sessions col.markers { width: 170px; }
td .excerpt { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
th { text-align: left; font-size: 12px; font-weight: 600; color: var(--ink-2); padding: 0 14px 10px; }
td { padding: 13px 14px; font-size: 13px; border-radius: 8px; }
tbody tr:nth-child(odd) { background: #f4f6f8; }
tbody tr.row-click { cursor: pointer; }
tbody tr.row-click:hover { background: #eaeef5; }
tbody tr[aria-selected="true"] { outline: 2px solid var(--blue); outline-offset: -2px; }
.chip { display: inline-block; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-weight: 600; }
.chip.redacted { background: rgba(216,31,106,.12); color: var(--pink); }
.chip.truncated { background: rgba(183,121,31,.14); color: var(--amber); }
.chip.sanitized { background: rgba(31,79,216,.12); color: var(--blue); }
.chip.unknown_event_kind { background: #eceef2; color: var(--ink-2); }
.chip.clean { background: rgba(23,160,138,.12); color: var(--teal); }
.muted { color: var(--ink-3); }
.empty { padding: 60px 0; text-align: center; color: var(--ink-3); }
.banner { display: flex; align-items: center; gap: 16px; padding: 15px 18px; border: 1px solid var(--line); border-radius: 10px; background: #f4f6f8; margin-bottom: 22px; }
.banner strong { font-size: 15px; }
.btn { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 550; cursor: pointer; }
.btn:hover { background: #f0f2f5; }
.btn.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
.btn.primary:hover { background: #22272e; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.spacer { margin-left: auto; }
.detail { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 24px; }
.detail h2 { font-size: 14px; font-weight: 620; margin: 0 0 14px; }
.item { padding: 11px 0; border-bottom: 1px solid #f0f2f5; }
.item .head { display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--ink-3); }
.item pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; color: var(--ink); }
mark { background: rgba(216,31,106,.18); color: var(--pink); border-radius: 3px; padding: 0 2px; font-weight: 600; }
mark.trunc { background: rgba(183,121,31,.18); color: var(--amber); }
.rules { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
.rule { border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; min-width: 150px; }
.rule .n { font-size: 24px; font-weight: 660; letter-spacing: -.02em; }
.rule .k { font-size: 12px; color: var(--ink-2); margin-top: 2px; }
input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--blue); cursor: pointer; }
</style>
</head>
<body>
<div class="layout">
  <nav class="rail" id="rail"></nav>
  <main class="panel">
    <div class="topbar"><h1 id="title">Overview</h1><div class="root-chip mono" id="root"></div></div>
    <div class="body" id="view"><div class="empty">Loading…</div></div>
  </main>
</div>
<script>
const TABS = [
  { id: "overview", label: "Overview", icon: "\\u25EB" },
  { id: "sessions", label: "Sessions", icon: "\\u2263" },
  { id: "privacy", label: "Privacy filter", icon: "\\u25C9" },
  { id: "egress", label: "Upload", icon: "\\u2191" },
];
const state = { tab: "overview", sessions: [], selected: new Set(), overview: null, active: null, report: null, privacy: null, egress: null, root: "" };
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bytes = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
const num = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\\.0$/, "") + "K" : String(n);
const api = async (path, init) => { const r = await fetch(path, init); if (!r.ok) throw new Error((await r.json()).error); return r.json(); };

const highlight = (text) => esc(text)
  .replaceAll("[redacted]", '<mark>[redacted]</mark>')
  .replaceAll("\\u2026[truncated]", '<mark class="trunc">\\u2026[truncated]</mark>');

const markerChips = (markers) => markers.length === 0
  ? '<span class="chip clean">clean</span>'
  : [...new Set(markers.map((m) => m.kind))].map((k) => '<span class="chip ' + k + '">' + k + "</span>").join(" ");

function renderRail() {
  el("rail").innerHTML = TABS.map((t) =>
    '<button data-tab="' + t.id + '" title="' + t.label + '" aria-current="' + (state.tab === t.id) + '">' + t.icon + "</button>"
  ).join("");
  el("rail").querySelectorAll("button").forEach((b) => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });
}

function renderTabs() {
  return '<div class="tabs">' + TABS.map((t) =>
    '<button data-tab="' + t.id + '" aria-selected="' + (state.tab === t.id) + '">' + t.label + "</button>"
  ).join("") + "</div>";
}

function overviewView() {
  const o = state.overview;
  if (!o) return '<div class="empty">Loading\\u2026</div>';
  if (o.sessionCount === 0) return renderTabs() + '<div class="empty">No collected sessions under this root yet.</div>';
  const max = Math.max(...o.days.map((d) => d.sessionCount), 1);
  const chart = o.days.slice(0, 14).reverse().map((d) => {
    const h = (d.sessionCount / max) * 100;
    const filtered = d.sessionCount === 0 ? 0 : (d.redactedSessionCount / d.sessionCount) * h;
    return '<div class="col"><div class="seg filtered" style="height:' + filtered + '%"></div>' +
      '<div class="seg safe" style="height:' + (h - filtered) + '%"></div>' +
      '<div class="cap">' + d.day.slice(5) + "</div></div>";
  }).join("");
  const rows = o.days.map((d) =>
    "<tr><td><strong>" + d.day + "</strong></td><td>" + d.sessionCount + "</td><td>" + num(d.eventCount) +
    "</td><td>" + bytes(d.byteCount) + "</td><td>" +
    (d.redactedSessionCount > 0 ? '<span class="chip redacted">' + d.redactedSessionCount + " filtered</span>" : '<span class="chip clean">none</span>') +
    "</td></tr>").join("");
  const runtimes = o.runtimeCounts.map((r) => '<div class="rule"><div class="n">' + r.count + '</div><div class="k mono">' + esc(r.runtime) + "</div></div>").join("");
  return renderTabs() +
    '<div class="kpis">' +
    '<div><div class="kpi-value">' + num(o.sessionCount) + '</div><div class="kpi-label"><i></i>Sessions collected</div></div>' +
    '<div><div class="kpi-value">' + num(o.eventCount) + '</div><div class="kpi-label teal"><i></i>Events</div></div>' +
    '<div><div class="kpi-value">' + bytes(o.byteCount) + '</div><div class="kpi-label teal"><i></i>On disk</div></div>' +
    '<div><div class="kpi-value">' + num(o.redactedSessionCount) + '</div><div class="kpi-label pink"><i></i>Sessions with redactions</div></div>' +
    "</div>" +
    '<div class="chart">' + chart + "</div>" +
    "<table><thead><tr><th>Day</th><th>Sessions</th><th>Events</th><th>Bytes</th><th>Privacy filter</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    (o.undatedSessionCount > 0 ? '<p class="muted">' + o.undatedSessionCount + " session(s) carry no timestamp and are excluded from day rows.</p>" : "") +
    '<div class="detail"><h2>Runtimes</h2><div class="rules">' + runtimes + "</div></div>";
}

function sessionsView() {
  if (state.sessions.length === 0) return renderTabs() + '<div class="empty">No collected sessions under this root yet.</div>';
  const rows = state.sessions.map((s) =>
    '<tr class="row-click" data-selector="' + s.selector + '" aria-selected="' + (state.active === s.selector) + '">' +
    '<td><input type="checkbox" data-pick="' + s.selector + '"' + (state.selected.has(s.selector) ? " checked" : "") + " /></td>" +
    '<td title="' + esc(s.firstRequestExcerpt || "") + '"><strong class="excerpt">' + esc(s.firstRequestExcerpt || "(no request recorded)") + "</strong><span class=\\"muted mono\\">" + s.selector.slice(0, 18) + "\\u2026</span></td>" +
    '<td class="mono">' + esc(s.runtime) + "</td>" +
    '<td class="mono">' + (s.earliestTimestamp === "unknown" ? "unknown" : s.earliestTimestamp.slice(0, 16).replace("T", " ")) + "</td>" +
    "<td>" + s.eventCount + "</td><td>" + bytes(s.byteCount) + "</td><td>" + markerChips(s.markers) + "</td></tr>").join("");
  const detail = state.report
    ? '<div class="detail"><h2>Session work items \\u2014 exactly what would be uploaded</h2>' +
      state.report.items.map((i) =>
        '<div class="item"><div class="head"><span class="chip ' + (i.markers.length ? i.markers[0].kind : "clean") + '">' + i.kind +
        '</span><span class="mono">#' + i.eventIndex + "</span>" + (i.timestamp ? '<span class="mono">' + i.timestamp.slice(0, 19).replace("T", " ") + "</span>" : "") +
        "</div><pre>" + highlight(i.text) + "</pre></div>").join("") +
      (state.report.omittedItemCount > 0 ? '<p class="muted">' + state.report.omittedItemCount + " further item(s) omitted from this report.</p>" : "") +
      "</div>"
    : '<div class="detail"><p class="muted">Select a row to read the stored, already-filtered content.</p></div>';
  return renderTabs() +
    '<div class="banner"><strong>' + state.selected.size + " of " + state.sessions.length + " selected for upload</strong>" +
    '<span class="muted">Nothing leaves this machine until you publish a bundle.</span>' +
    '<span class="spacer"></span><button class="btn" id="pick-all">Select all</button><button class="btn" id="pick-none">Clear</button></div>' +
    '<table class="sessions"><colgroup><col class="pick" /><col /><col class="meta" /><col class="meta" /><col class="small" /><col class="small" /><col class="markers" /></colgroup>' +
    "<thead><tr><th></th><th>First request</th><th>Runtime</th><th>Earliest</th><th>Events</th><th>Bytes</th><th>Filter markers</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    detail;
}

function privacyView() {
  const head = renderTabs() + '<div class="banner"><strong>Privacy filter</strong><span class="muted">Credential redaction, oversize truncation, and terminal-control sanitisation are applied before a trace is written to disk.</span></div>';
  if (state.sessions.length === 0) return head + '<div class="empty">No collected sessions under this root yet.</div>';
  if (!state.privacy) return head + '<div class="empty">Pick a session in the Sessions tab to inspect its filter findings.</div>';
  const p = state.privacy;
  const rules = p.ruleCounts.length === 0
    ? '<div class="rule"><div class="n">0</div><div class="k">nothing filtered</div></div>'
    : p.ruleCounts.map((r) => '<div class="rule"><div class="n">' + r.count + '</div><div class="k mono">' + r.family + "</div></div>").join("");
  const findings = p.findings.length === 0
    ? '<p class="muted">This session needed no filtering.</p>'
    : p.findings.map((f) =>
        '<div class="item"><div class="head"><span class="chip ' + (f.family === "oversized_value" ? "truncated" : f.family === "terminal_control" ? "sanitized" : "redacted") + '">' + f.family +
        '</span><span class="mono">#' + f.eventIndex + "</span><span class=\\"mono\\">" + esc(f.path || "(root)") + "</span>" +
        (f.keyName ? '<span class="mono">key=' + esc(f.keyName) + "</span>" : "") +
        "</div><pre>" + highlight(f.storedText) + "</pre></div>").join("");
  return head +
    '<p class="muted mono">' + p.selector.slice(0, 22) + "\\u2026 \\u00b7 " + esc(p.runtime) + " \\u00b7 " + p.eventCount + " events \\u00b7 " + bytes(p.byteCount) + "</p>" +
    '<div class="rules">' + rules + "</div>" +
    '<div class="detail"><h2>Findings</h2>' + findings +
    (p.omittedFindingCount > 0 ? '<p class="muted">' + p.omittedFindingCount + " further finding(s) omitted.</p>" : "") + "</div>";
}

function egressView() {
  const e = state.egress;
  if (!e) return renderTabs() + '<div class="empty">Loading\\u2026</div>';
  const rules = e.ruleCounts.length === 0
    ? '<div class="rule"><div class="n">0</div><div class="k">redactions in this egress</div></div>'
    : e.ruleCounts.map((r) => '<div class="rule"><div class="n">' + r.count + '</div><div class="k mono">' + r.family + "</div></div>").join("");
  return renderTabs() +
    '<div class="banner"><strong>Egress preview</strong><span class="muted">This is the complete set of bytes a candidate bundle would contain.</span></div>' +
    '<div class="kpis">' +
    '<div><div class="kpi-value">' + e.selectedCount + " / " + e.availableCount + '</div><div class="kpi-label"><i></i>Sessions selected</div></div>' +
    '<div><div class="kpi-value">' + bytes(e.byteCount) + '</div><div class="kpi-label teal"><i></i>Bytes leaving</div></div>' +
    '<div><div class="kpi-value">' + num(e.eventCount) + '</div><div class="kpi-label teal"><i></i>Events leaving</div></div>' +
    "</div><div class=\\"rules\\">" + rules + "</div>" +
    '<div class="detail"><h2>Selectors in this egress</h2>' +
    (e.selectors.length === 0 ? '<p class="muted">Nothing selected. An empty selection uploads nothing.</p>'
      : '<pre class="mono">' + e.selectors.map(esc).join("\\n") + "</pre>") + "</div>";
}

function bind() {
  el("view").querySelectorAll(".tabs button").forEach((b) => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });
  el("view").querySelectorAll("tr.row-click").forEach((tr) => {
    tr.onclick = async (event) => {
      if (event.target.matches("input[type=checkbox]")) return;
      state.active = tr.dataset.selector;
      state.report = await api("/api/sessions/" + state.active + "/report");
      state.privacy = await api("/api/sessions/" + state.active + "/privacy");
      render();
    };
  });
  el("view").querySelectorAll("input[data-pick]").forEach((box) => {
    box.onchange = async () => {
      if (box.checked) state.selected.add(box.dataset.pick); else state.selected.delete(box.dataset.pick);
      await saveSelection();
    };
  });
  const all = el("pick-all"); const none = el("pick-none");
  if (all) all.onclick = async () => { state.sessions.forEach((s) => state.selected.add(s.selector)); await saveSelection(); };
  if (none) none.onclick = async () => { state.selected.clear(); await saveSelection(); };
}

async function saveSelection() {
  await api("/api/selection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectors: [...state.selected] }),
  });
  state.egress = await api("/api/egress-preview");
  render();
}

function render() {
  renderRail();
  el("title").textContent = TABS.find((t) => t.id === state.tab).label;
  el("root").textContent = state.root;
  el("view").innerHTML =
    state.tab === "overview" ? overviewView()
    : state.tab === "sessions" ? sessionsView()
    : state.tab === "privacy" ? privacyView()
    : egressView();
  bind();
}

(async () => {
  const meta = await api("/api/meta");
  state.root = meta.root;
  state.overview = await api("/api/overview");
  const listing = await api("/api/sessions");
  state.sessions = listing.sessions;
  state.selected = new Set(listing.selected);
  state.egress = await api("/api/egress-preview");
  render();
})();
</script>
</body>
</html>
`;
