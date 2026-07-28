import { MarketplaceError } from "../marketplace/error";
import { buildSessionListItem, buildSessionReport } from "../marketplace/session-report";
import { resolveTraceSelector, scanSessionSnapshot } from "../marketplace/session-snapshot";
import type {
  FrozenTrace,
  SessionList,
  SessionSnapshot,
  ValidatedTrace,
} from "../marketplace/session-contract";
import { harnessTraceDocumentSchema } from "../trajectory/adapters/contract";
import { consoleAppHtml } from "./app-html";
import { ConsoleError, selectionRequestSchema } from "./contract";
import { sessionRowExcerpt } from "./excerpt";
import type { PrivacyRuleCount, PrivacyRuleFamily } from "./contract";
import { buildConsoleOverview, buildEgressPreview } from "./overview";
import { summarizePrivacyFiltering } from "./privacy-summary";
import { readSelection, writeSelection } from "./selection";

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const errorResponse = (code: ConsoleError["code"]): Response =>
  jsonResponse({ error: code }, code === "invalid_request" ? 400 : 404);

const validate = (frozenTrace: FrozenTrace): ValidatedTrace => {
  const document = harnessTraceDocumentSchema.safeParse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frozenTrace.bytes)),
  );
  if (!document.success) throw new MarketplaceError("invalid_trace");
  return { frozenTrace, document: document.data };
};

const listSessions = (snapshot: SessionSnapshot): SessionList =>
  snapshot.traces.map((trace) => {
    const item = buildSessionListItem(validate(trace));
    return { ...item, firstRequestExcerpt: sessionRowExcerpt(item.firstRequestExcerpt) };
  });

const traceFor = (snapshot: SessionSnapshot, selector: string): ValidatedTrace => {
  try {
    return validate(resolveTraceSelector(snapshot, selector));
  } catch {
    throw new ConsoleError("invalid_selector");
  }
};

const mergeRuleCounts = (
  summaries: readonly PrivacyRuleCount[][],
): readonly PrivacyRuleCount[] => {
  const tally = new Map<PrivacyRuleFamily, number>();
  for (const counts of summaries) {
    for (const entry of counts) tally.set(entry.family, (tally.get(entry.family) ?? 0) + entry.count);
  }
  return [...tally.entries()].map(([family, count]) => ({ family, count }));
};

const selectionFromRequest = async (request: Request): Promise<readonly string[]> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ConsoleError("invalid_request");
  }
  const parsed = selectionRequestSchema.safeParse(payload);
  if (!parsed.success) throw new ConsoleError("invalid_request");
  return parsed.data.selectors;
};

const sessionRoute = (pathname: string): Readonly<{ selector: string; view: string }> | undefined => {
  const match = /^\/api\/sessions\/([^/]+)\/(report|privacy)$/u.exec(pathname);
  if (match === null) return undefined;
  const selector = match[1];
  const view = match[2];
  if (selector === undefined || view === undefined) return undefined;
  return { selector: decodeURIComponent(selector), view };
};

const routeRequest = async (request: Request, root: string): Promise<Response> => {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return new Response(consoleAppHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (request.method === "GET" && pathname === "/api/meta") {
    return jsonResponse({ root });
  }

  if (request.method === "GET" && pathname === "/api/overview") {
    return jsonResponse(buildConsoleOverview(listSessions(scanSessionSnapshot(root))));
  }

  if (request.method === "GET" && pathname === "/api/sessions") {
    const snapshot = scanSessionSnapshot(root);
    return jsonResponse({ sessions: listSessions(snapshot), selected: readSelection(root) });
  }

  const session = sessionRoute(pathname);
  if (request.method === "GET" && session !== undefined) {
    const trace = traceFor(scanSessionSnapshot(root), session.selector);
    return jsonResponse(
      session.view === "report" ? buildSessionReport(trace) : summarizePrivacyFiltering(trace),
    );
  }

  if (request.method === "POST" && pathname === "/api/selection") {
    const requested = await selectionFromRequest(request);
    const snapshot = scanSessionSnapshot(root);
    const known = new Set(snapshot.traces.map((trace) => trace.selector as string));
    if (requested.some((selector) => !known.has(selector))) {
      throw new ConsoleError("invalid_selector");
    }
    return jsonResponse({ selected: writeSelection(root, requested) });
  }

  if (request.method === "GET" && pathname === "/api/egress-preview") {
    const snapshot = scanSessionSnapshot(root);
    const items = listSessions(snapshot);
    const selected = readSelection(root);
    const chosen = new Set<string>(selected);
    const ruleCounts = mergeRuleCounts(
      snapshot.traces
        .filter((trace) => chosen.has(trace.selector))
        .map((trace) => [...summarizePrivacyFiltering(validate(trace)).ruleCounts]),
    );
    return jsonResponse(buildEgressPreview(items, selected, ruleCounts));
  }

  throw new ConsoleError("unknown_route");
};

export const handleConsoleRequest = async (request: Request, root: string): Promise<Response> => {
  try {
    return await routeRequest(request, root);
  } catch (error) {
    if (error instanceof ConsoleError) return errorResponse(error.code);
    if (error instanceof MarketplaceError) return jsonResponse({ error: error.code }, 422);
    return jsonResponse({ error: "console_failed" }, 500);
  }
};
