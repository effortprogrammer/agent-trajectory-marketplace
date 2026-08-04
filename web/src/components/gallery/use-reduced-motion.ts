import { useEffect, useState } from "react";

/**
 * Tracks the `prefers-reduced-motion` media query. When true, the gallery does
 * NOT autoplay videos on hover (posters stay put) and skips fade-in transitions.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia == null) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}
