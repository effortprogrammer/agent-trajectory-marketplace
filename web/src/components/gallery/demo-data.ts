import type { GalleryItem, MediaKind } from "./types.ts";

/**
 * Demo data for the History gallery.
 *
 * Everything is generated deterministically (seeded PRNG) so the justified
 * layout is stable across renders — which keeps scroll-anchoring exact and makes
 * the virtualization behaviour reproducible. The pool mixes real still assets
 * (`/presets/*.png`) with the ffmpeg-generated hover-to-play clips
 * (`/gallery/*.mp4`) and spans a wide spread of aspect ratios: tall portraits,
 * wide landscapes, squares and true panoramas.
 */

// A tiny deterministic PRNG (mulberry32) — stable ids and ratios per index.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StillBase {
  src: string;
  alt: string;
  prompt: string;
}

// PLACEHOLDER ASSETS — template demo art (see /presets/*.png). When adapting
// this template into a real app, REPLACE media that represents the product
// (hero/example outputs, covers, before/after samples, feed items) with
// bespoke on-brand assets generated via the Higgsfield generation tools.
// Pure style-picker label thumbnails may keep simple placeholder art when
// real output depends on the user's own upload. Grep "PLACEHOLDER ASSETS"
// to find every site.
const STILLS: StillBase[] = [
  {
    src: "/presets/cover.png",
    alt: "Renaissance portrait holding a jar of dill pickles",
    prompt:
      "A renaissance oil-painting portrait of a woman cradling a glowing jar of Picklehaus dill pickles, candlelit chiaroscuro, rich golden fabrics.",
  },
  {
    src: "/presets/how-product-works.png",
    alt: "Cinematic product hero shot",
    prompt:
      "Cinematic product hero shot explaining how the pickling process works, warm studio light, shallow depth of field.",
  },
  {
    src: "/presets/explain.png",
    alt: "Candlelit concept explainer scene",
    prompt:
      "Moody candlelit scene explaining a concept, editorial photography, deep shadows and warm highlights.",
  },
  {
    src: "/presets/hyper-motion.png",
    alt: "Caramel popcorn splash in motion",
    prompt:
      "Hyper-motion macro of caramel popcorn bursting mid-air with sugar crystals, high-speed capture, glossy amber tones.",
  },
];

interface VideoBase {
  videoSrc: string;
  poster: string;
  alt: string;
  prompt: string;
  width: number;
  height: number;
}

// Real clips (ffmpeg Ken-Burns renders) with their true dimensions.
// PLACEHOLDER ASSETS — demo data; replace when adapting (see note above).
const VIDEOS: VideoBase[] = [
  {
    videoSrc: "/gallery/motion-landscape.mp4",
    poster: "/presets/hyper-motion.png",
    alt: "Popcorn burst, animated",
    prompt:
      "Slow push-in on caramel popcorn bursting mid-air, high-speed macro loop, glossy amber tones.",
    width: 854,
    height: 480,
  },
  {
    videoSrc: "/gallery/product-portrait.mp4",
    poster: "/presets/how-product-works.png",
    alt: "Product hero, animated",
    prompt: "Vertical hero reveal of the product with a gentle parallax zoom, warm studio light.",
    width: 480,
    height: 854,
  },
  {
    videoSrc: "/gallery/explain-square.mp4",
    poster: "/presets/explain.png",
    alt: "Candlelit concept, animated",
    prompt: "Square looping candlelit scene with drifting highlights, editorial mood.",
    width: 600,
    height: 600,
  },
  {
    videoSrc: "/gallery/cover-tall.mp4",
    poster: "/presets/cover.png",
    alt: "Renaissance portrait, animated",
    prompt: "Tall portrait with a slow breathing zoom, candlelit chiaroscuro, golden fabrics.",
    width: 512,
    height: 768,
  },
];

// A generous spread of aspect ratios (width : height) for the still items.
const ASPECTS: [number, number][] = [
  [9, 16], // tall portrait
  [2, 3], // portrait
  [3, 4], // portrait
  [1, 1], // square
  [4, 3], // landscape
  [3, 2], // landscape
  [16, 9], // wide
  [2, 1], // panoramic
  [21, 9], // ultra-wide panorama
  [5, 4], // near-square
];

/**
 * A dated batch definition: the label plus how many items land in it. Later
 * batches are appended lazily by `makeBatch` to simulate infinite history.
 */
// PLACEHOLDER ASSETS — demo data; replace when adapting (see note above).
export const GROUPS = [
  { id: "today", label: "Today", count: 34 },
  { id: "yesterday", label: "Yesterday", count: 42 },
  { id: "this-week", label: "Earlier this week", count: 56 },
  { id: "last-week", label: "Last week", count: 60 },
] as const;

/** Long side (px) used to synthesize still dimensions from an aspect ratio. */
const LONG_SIDE = 1280;

function makeStill(
  index: number,
  groupId: string,
  groupLabel: string,
  rand: () => number,
): GalleryItem {
  const base = STILLS[index % STILLS.length]!;
  const [aw, ah] = ASPECTS[Math.floor(rand() * ASPECTS.length)]!;
  const landscape = aw >= ah;
  const width = landscape ? LONG_SIDE : Math.round((LONG_SIDE * aw) / ah);
  const height = landscape ? Math.round((LONG_SIDE * ah) / aw) : LONG_SIDE;
  return {
    id: `${groupId}-img-${index}`,
    kind: "image",
    status: "ready",
    src: base.src,
    width,
    height,
    prompt: base.prompt,
    alt: base.alt,
    groupId,
    groupLabel,
  };
}

function makeVideo(index: number, groupId: string, groupLabel: string): GalleryItem {
  const base = VIDEOS[index % VIDEOS.length]!;
  return {
    id: `${groupId}-vid-${index}`,
    kind: "video",
    status: "ready",
    src: base.poster,
    videoSrc: base.videoSrc,
    width: base.width,
    height: base.height,
    prompt: base.prompt,
    alt: base.alt,
    groupId,
    groupLabel,
  };
}

/**
 * Build one dated batch of items. Roughly every 5th item is a video so the
 * feed reliably shows hover-to-play tiles. When `withGenerating` is set the
 * batch leads with a single `generating` placeholder tile (the pulsing card).
 */
export function makeBatch(
  groupId: string,
  groupLabel: string,
  count: number,
  seed: number,
  withGenerating = false,
): GalleryItem[] {
  const rand = mulberry32(seed);
  const items: GalleryItem[] = [];

  if (withGenerating) {
    items.push({
      id: `${groupId}-generating`,
      kind: "image",
      status: "generating",
      src: "",
      width: 3,
      height: 4,
      prompt: "",
      alt: "",
      groupId,
      groupLabel,
    });
  }

  for (let i = 0; i < count; i++) {
    const kind: MediaKind = i % 5 === 2 ? "video" : "image";
    items.push(
      kind === "video"
        ? makeVideo(i, groupId, groupLabel)
        : makeStill(i, groupId, groupLabel, rand),
    );
  }
  return items;
}

/** The initial dataset — the four seeded batches, a generating tile up top. */
export function makeInitialItems(): GalleryItem[] {
  return GROUPS.flatMap((group, gi) =>
    makeBatch(group.id, group.label, group.count, 1000 + gi * 97, gi === 0),
  );
}

/**
 * Lazily-appended "older" batch, used by the infinite-scroll loader. Each call
 * yields a fresh dated group ("Earlier · N") so appending never reflows the
 * batches already on screen above.
 */
export function makeOlderBatch(page: number): GalleryItem[] {
  const id = `earlier-${page}`;
  const label = page === 0 ? "Earlier" : `Earlier · ${page + 1}`;
  const count = 48;
  return makeBatch(id, label, count, 5000 + page * 131);
}
