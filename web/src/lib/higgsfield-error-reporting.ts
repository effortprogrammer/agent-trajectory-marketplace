type HiggsfieldErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type HiggsfieldEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: HiggsfieldErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __higgsfieldEvents?: HiggsfieldEvents;
  }
}

export function reportHiggsfieldError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.__higgsfieldEvents?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}
