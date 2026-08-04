import { findHiggsfieldDesignElement, getHiggsfieldDesignMeta } from "./registry";
import {
  DESIGN_MODE_PROTOCOL,
  DESIGN_MODE_PROTOCOL_VERSION,
  type DesignModePreviewCropMessage,
  type DesignModeSetMessage,
  type DesignSelectionContext,
  type DesignSelectionElement,
  type DesignSelectionPoint,
} from "./protocol";

type InspectorState = {
  enabled: boolean;
  sessionId: string | null;
  appId: string | null;
  parentOrigin: string | null;
  lastHoverElement: Element | null;
  lastPointer: DesignSelectionPoint | null;
  pendingHover: {
    element: Element;
    pointer: DesignSelectionPoint;
  } | null;
  raf: number | null;
  scrollStopTimer: number | null;
};

declare global {
  interface Window {
    __higgsfieldDesignInspectorInstalled?: boolean;
  }
}

const SAFE_ATTRIBUTE_NAMES = new Set([
  "alt",
  "aria-label",
  "href",
  "id",
  "name",
  "placeholder",
  "src",
  "title",
  "type",
]);

const SAFE_STYLE_NAMES = [
  "backgroundColor",
  "borderColor",
  "borderRadius",
  "color",
  "display",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "gap",
  "height",
  "margin",
  "padding",
  "position",
  "width",
] as const;

const state: InspectorState = {
  enabled: false,
  sessionId: null,
  appId: null,
  parentOrigin: null,
  lastHoverElement: null,
  lastPointer: null,
  pendingHover: null,
  raf: null,
  scrollStopTimer: null,
};

const CURSOR_STYLE_ID = "higgsfield-design-inspector-cursor-style";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSetMessage(value: unknown): value is DesignModeSetMessage {
  return (
    isRecord(value) &&
    value.protocol === DESIGN_MODE_PROTOCOL &&
    value.version === DESIGN_MODE_PROTOCOL_VERSION &&
    value.type === "HF_DESIGN_MODE_SET" &&
    typeof value.sessionId === "string" &&
    typeof value.enabled === "boolean"
  );
}

function isPreviewCropMessage(value: unknown): value is DesignModePreviewCropMessage {
  return (
    isRecord(value) &&
    value.protocol === DESIGN_MODE_PROTOCOL &&
    value.version === DESIGN_MODE_PROTOCOL_VERSION &&
    value.type === "HF_DESIGN_PREVIEW_CROP_SET" &&
    typeof value.sessionId === "string" &&
    isRecord(value.selection) &&
    isRecord(value.selection.viewport)
  );
}

function truncate(value: string, max = 180): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, max);
}

function sanitizeUrlish(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^(javascript|data|blob):/i.test(trimmed)) {
    return undefined;
  }

  try {
    const url = new URL(trimmed, window.location.origin);
    url.search = "";
    url.hash = "";
    return truncate(url.href, 180);
  } catch {
    return truncate(trimmed.split(/[?#]/)[0] ?? "", 180);
  }
}

function safeAttributes(element: Element): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (!SAFE_ATTRIBUTE_NAMES.has(attribute.name)) {
      continue;
    }

    const value =
      attribute.name === "href" || attribute.name === "src"
        ? sanitizeUrlish(attribute.value)
        : truncate(attribute.value, 160);

    if (value) {
      attrs[attribute.name] = value;
    }
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

function safeClassList(element: Element): string[] | undefined {
  const classes = Array.from(element.classList)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= 120)
    .slice(0, 12);

  return classes.length > 0 ? classes : undefined;
}

function safeTextSnippet(element: Element): string | undefined {
  const tagName = element.tagName.toLowerCase();
  if (["input", "textarea", "select", "option"].includes(tagName)) {
    return undefined;
  }
  return truncate(element.textContent ?? "", 220);
}

function safeComputedStyle(element: Element): Record<string, string> | undefined {
  const computed = window.getComputedStyle(element);
  const style: Record<string, string> = {};
  for (const key of SAFE_STYLE_NAMES) {
    const value = computed[key];
    if (value) {
      style[key] = value;
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function elementMeta(element: Element): DesignSelectionElement {
  const sourceMeta = getHiggsfieldDesignMeta(element);
  const attrs = safeAttributes(element);
  const classes = safeClassList(element);
  const computedStyle = safeComputedStyle(element);

  return {
    tagName: element.tagName.toLowerCase(),
    ...(sourceMeta?.nodeId ? { nodeId: sourceMeta.nodeId } : {}),
    ...(sourceMeta?.componentName ? { componentName: sourceMeta.componentName } : {}),
    ...(sourceMeta?.sourceFile ? { sourceFile: sourceMeta.sourceFile } : {}),
    ...(sourceMeta?.sourceLine ? { sourceLine: sourceMeta.sourceLine } : {}),
    ...(sourceMeta?.sourceColumn ? { sourceColumn: sourceMeta.sourceColumn } : {}),
    ...(sourceMeta?.routeFile ? { routeFile: sourceMeta.routeFile } : {}),
    ...(element.getAttribute("role") ? { role: element.getAttribute("role") ?? undefined } : {}),
    ...(element.getAttribute("aria-label")
      ? { ariaLabel: truncate(element.getAttribute("aria-label") ?? "", 160) }
      : {}),
    ...(safeTextSnippet(element) ? { textSnippet: safeTextSnippet(element) } : {}),
    ...(classes ? { classList: classes } : {}),
    ...(attrs ? { attributes: attrs } : {}),
    ...(computedStyle ? { computedStyle } : {}),
  };
}

function findSelectableElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const instrumented = findHiggsfieldDesignElement(target);
  if (
    instrumented &&
    instrumented.element !== document.documentElement &&
    instrumented.element !== document.body
  ) {
    return instrumented.element;
  }

  const preferred = target.closest<HTMLElement>("button, a, input, textarea, select, [role]");
  if (preferred && preferred !== document.documentElement && preferred !== document.body) {
    return preferred;
  }

  let current: Element | null = target;
  while (current && current !== document.documentElement && current !== document.body) {
    const rect = current.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function selectionForElement(
  element: Element,
  pointer?: DesignSelectionPoint,
): DesignSelectionContext {
  const rect = element.getBoundingClientRect();
  const sourceMeta = getHiggsfieldDesignMeta(element);
  const ancestors: DesignSelectionElement[] = [];
  let current = element.parentElement;
  while (current && current !== document.body && ancestors.length < 5) {
    ancestors.push(elementMeta(current));
    current = current.parentElement;
  }

  return {
    protocol: DESIGN_MODE_PROTOCOL,
    version: DESIGN_MODE_PROTOCOL_VERSION,
    sessionId: state.sessionId ?? "",
    ...(state.appId ? { appId: state.appId } : {}),
    previewOrigin: window.location.origin,
    route: sourceMeta?.routeFile ?? window.location.pathname,
    path: window.location.pathname,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    ...(pointer ? { pointer } : {}),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    element: elementMeta(element),
    ancestors,
    source: sourceMeta ? "instrumented" : "heuristic",
  };
}

function post(
  type:
    | "HF_DESIGN_READY"
    | "HF_DESIGN_HOVER"
    | "HF_DESIGN_SELECT"
    | "HF_DESIGN_SCROLL"
    | "HF_DESIGN_EXIT"
    | "HF_DESIGN_ERROR",
  payload: Record<string, unknown> = {},
) {
  if (!state.parentOrigin || !state.sessionId) {
    return;
  }

  window.parent.postMessage(
    {
      protocol: DESIGN_MODE_PROTOCOL,
      version: DESIGN_MODE_PROTOCOL_VERSION,
      type,
      sessionId: state.sessionId,
      ...(state.appId ? { appId: state.appId } : {}),
      ...payload,
    },
    state.parentOrigin,
  );
}

function currentViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function sendHover(element: Element, pointer?: DesignSelectionPoint) {
  post("HF_DESIGN_HOVER", { selection: selectionForElement(element, pointer) });
}

function pointFromEvent(event: PointerEvent | MouseEvent): DesignSelectionPoint {
  return { x: event.clientX, y: event.clientY };
}

function modifiersFromEvent(event: MouseEvent) {
  return {
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  };
}

function scheduleHover(element: Element, pointer: DesignSelectionPoint) {
  state.pendingHover = { element, pointer };

  if (state.raf !== null) {
    return;
  }

  state.raf = window.requestAnimationFrame(() => {
    state.raf = null;
    const pending = state.pendingHover;
    state.pendingHover = null;
    if (!state.enabled || !pending) {
      return;
    }
    sendHover(pending.element, pending.pointer);
  });
}

function onPointerMove(event: PointerEvent) {
  if (!state.enabled) {
    return;
  }
  const element = findSelectableElement(event.target);
  if (!element) {
    return;
  }
  const pointer = pointFromEvent(event);
  state.lastPointer = pointer;
  state.lastHoverElement = element;
  scheduleHover(element, pointer);
}

function onClick(event: MouseEvent) {
  if (!state.enabled) {
    return;
  }
  const element = findSelectableElement(event.target);
  if (!element) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  post("HF_DESIGN_SELECT", {
    selection: selectionForElement(element, pointFromEvent(event)),
    modifiers: modifiersFromEvent(event),
  });
}

function setInspectorCursor(enabled: boolean) {
  document.getElementById(CURSOR_STYLE_ID)?.remove();

  if (!enabled) {
    return;
  }

  const style = document.createElement("style");
  style.id = CURSOR_STYLE_ID;
  style.textContent = `
    body[data-selector-active="true"],
    body[data-selector-active="true"] * {
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(style);
}

function setSelectorState(enabled: boolean) {
  const target = document.body ?? document.documentElement;
  target.toggleAttribute("data-selector-active", enabled);
  if (enabled) {
    target.setAttribute("data-selector-interaction-mode", "selection");
  } else {
    target.removeAttribute("data-selector-interaction-mode");
  }
  setInspectorCursor(enabled);
}

function flushPendingWork() {
  if (state.raf !== null) {
    window.cancelAnimationFrame(state.raf);
    state.raf = null;
  }
  if (state.scrollStopTimer !== null) {
    window.clearTimeout(state.scrollStopTimer);
    state.scrollStopTimer = null;
  }
  state.pendingHover = null;
}

function sendHoverAtLastPointer() {
  const pointer = state.lastPointer;
  if (!state.enabled || !pointer) {
    return;
  }

  const hit = document.elementFromPoint(pointer.x, pointer.y);
  const element = findSelectableElement(hit);
  if (!element) {
    state.lastHoverElement = null;
    return;
  }

  state.lastHoverElement = element;
  sendHover(element, pointer);
}

function onScroll() {
  if (!state.enabled) {
    return;
  }

  post("HF_DESIGN_SCROLL", { viewport: currentViewport() });
  state.lastHoverElement = null;
  state.pendingHover = null;

  if (state.raf !== null) {
    window.cancelAnimationFrame(state.raf);
    state.raf = null;
  }

  if (state.scrollStopTimer !== null) {
    window.clearTimeout(state.scrollStopTimer);
  }

  state.scrollStopTimer = window.setTimeout(() => {
    state.scrollStopTimer = null;
    sendHoverAtLastPointer();
  }, 180);
}

function exitDesignMode() {
  if (!state.enabled) {
    return;
  }

  state.enabled = false;
  state.lastHoverElement = null;
  state.lastPointer = null;
  flushPendingWork();
  setSelectorState(false);
  post("HF_DESIGN_EXIT");
}

function onKeyDown(event: KeyboardEvent) {
  if (!state.enabled || event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  exitDesignMode();
}

function setEnabled(message: DesignModeSetMessage, parentOrigin: string) {
  state.enabled = message.enabled;
  state.sessionId = message.sessionId;
  state.appId = message.appId ?? null;
  state.parentOrigin = parentOrigin;
  state.lastHoverElement = null;
  state.lastPointer = null;
  flushPendingWork();

  setSelectorState(message.enabled);

  if (message.enabled) {
    post("HF_DESIGN_READY");
  }
}

function scrollToPreviewCrop(message: DesignModePreviewCropMessage) {
  const { viewport } = message.selection;
  window.scrollTo({
    left: viewport.scrollX,
    top: viewport.scrollY,
    behavior: "instant",
  });
}

export function installHiggsfieldDesignInspector() {
  if (typeof window === "undefined" || window.__higgsfieldDesignInspectorInstalled) {
    return;
  }

  window.__higgsfieldDesignInspectorInstalled = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) {
      return;
    }
    if (isPreviewCropMessage(event.data)) {
      scrollToPreviewCrop(event.data);
      return;
    }
    if (isSetMessage(event.data)) {
      setEnabled(event.data, event.origin);
    }
  });

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("keydown", onKeyDown, true);
}
