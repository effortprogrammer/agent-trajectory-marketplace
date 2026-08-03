/**
 * ATM — scroll-scrub journey data. Candidate B direction: a lived-in 35mm
 * film-still world instead of the earlier diorama look. Five scenes, four
 * encoded dive clips plus one connector moment baked into the desk/office
 * chapters. Every poster is the exact first frame of the encoded clip beside
 * it; mobile clips are 480p encodes for phone decode budgets. All paths
 * self-contained under /assets/world/.
 */
import type {
  ScrollScrubScene,
  ScrollScrubConnector,
  ScrollScrubTheme,
} from "@/components/scroll-scrub/scroll-scrub";

/** Brand tokens for the journey layer. Locked in app/design-brief.md. */
export const scrollScrubTheme: ScrollScrubTheme = {
  accent: "#2DD4BF",
  background: "#0B1226",
  ink: "#EEF2FF",
  muted: "#94A3C7",
};

export const scrollScrubScenes: ScrollScrubScene[] = [
  {
    body: "Every session leaves a record.",
    clip: "/assets/world/b-desk.mp4",
    mobileClip: "/assets/world/b-desk-mobile.mp4",
    mobilePoster: "/assets/world/b-desk-mobile-poster.png",
    id: "scene-1",
    kicker: "Every session leaves a record.",
    label: "The desk",
    poster: "/assets/world/b-desk-poster.png",
    scroll: 1.6,
    linger: 0.5,
    tags: ["Real work", "Real repos"],
    title: "Your agent is already doing the work.",
  },
  {
    body: "Then it vanishes.",
    clip: "/assets/world/b-cupboard.mp4",
    mobileClip: "/assets/world/b-cupboard-mobile.mp4",
    mobilePoster: "/assets/world/b-cupboard-mobile-poster.png",
    id: "scene-2",
    kicker: "Then it vanishes.",
    label: "The drawer",
    poster: "/assets/world/b-cupboard-poster.png",
    scroll: 1.4,
    linger: 0.5,
    tags: ["Forgotten logs", "Wasted tokens"],
    title: "Every session ends in a drawer you never open again.",
  },
  {
    body: "Keys, tokens, env values.",
    clip: "/assets/world/b-logs.mp4",
    mobileClip: "/assets/world/b-logs-mobile.mp4",
    mobilePoster: "/assets/world/b-logs-mobile-poster.png",
    id: "scene-3",
    kicker: "Nothing leaves raw.",
    label: "The logs",
    poster: "/assets/world/b-logs-poster.png",
    scroll: 1.4,
    linger: 0.5,
    tags: ["Terminal active", "CLI watch"],
    title: "Keys, tokens, env values — the session writes them as it runs.",
  },
  {
    body: "Masked on your machine, before upload.",
    clip: "/assets/world/b-mask.mp4",
    mobileClip: "/assets/world/b-mask-mobile.mp4",
    mobilePoster: "/assets/world/b-mask-mobile-poster.png",
    id: "scene-4",
    kicker: "Nothing leaves raw.",
    label: "The cut",
    poster: "/assets/world/b-mask-poster.png",
    scroll: 1.6,
    linger: 0.5,
    tags: ["Masked locally", "Before upload"],
    title: "The moments worth saving get packaged locally, then you choose.",
  },
  {
    body: "Real work. Real repos. Now sold, and the envelope is yours.",
    clip: "/assets/world/b-sold.mp4",
    mobileClip: "/assets/world/b-sold-mobile.mp4",
    mobilePoster: "/assets/world/b-sold-mobile-poster.png",
    id: "scene-5",
    kicker: "Real work. Real repos.",
    label: "The payout",
    poster: "/assets/world/b-sold-poster.png",
    scroll: 1.8,
    linger: 0.55,
    tags: ["Operator reviewed", "Buyer matched"],
    title: "Real work. Real repos. Buyer pays, seller keeps.",
  },
];

/**
 * The B chain is intentionally Mode A between scenes: the copy chapters + the
 * engine's per-scene pause own the rhythm without needed connectors.
 * (The engine's connectors slot is left empty so Mode A semantics fire.)
 */
export const scrollScrubConnectors: (ScrollScrubConnector | null)[] = [
  null,
  null,
  null,
  null,
  null,
];
