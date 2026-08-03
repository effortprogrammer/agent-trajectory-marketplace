import { JustifiedGallery } from "@/components/gallery";
import type { GalleryItem } from "@/components/gallery";

/**
 * UserGenerations — THE single canonical component for any screen that shows a
 * BROWSABLE FEED of the current user's own generations (a History tab/page, an
 * "All generations" view, an after-generate results feed, …).
 *
 * It is personal-only: it renders the CURRENT user's work in this app — never
 * other users' work, never a public/community feed.
 *
 * Everything the feed needs lives INSIDE it and is reached ONLY through this
 * component — the virtualized justified-masonry gallery, the per-tile hover
 * actions (`CardActions`), the `GenerationDetailModal` lightbox, the pulsing
 * `generating` `GenerationCard`, density control, hover-to-play video and
 * infinite scroll. The `@/components/gallery` folder is the private
 * implementation of this component; screens must NOT import it (or hand-roll a
 * grid of `GenerationCard`/`Media`) directly — they render `<UserGenerations />`.
 *
 * The one thing that is NOT this component: a finite, in-flow result/variation
 * grid inside a wizard or generator (e.g. "pick the best of these 6") — that is
 * a distinct selectable pattern, a small Quanta `Grid` of `GenerationCard`s, not
 * a browsable personal feed.
 */
/** Live feeds require real items; seeded history is available only by explicit opt-in. */
export type UserGenerationsProps =
  | { demo: true; items?: never; hasMore?: never; loadingMore?: never; onLoadMore?: never }
  | {
      demo?: false;
      items: GalleryItem[];
      hasMore: boolean;
      loadingMore: boolean;
      onLoadMore: () => void | Promise<unknown>;
    };

export function UserGenerations(props: UserGenerationsProps) {
  return props.demo ? (
    <JustifiedGallery demo grouped={false} />
  ) : (
    <JustifiedGallery
      items={props.items}
      grouped={false}
      hasMore={props.hasMore}
      loadingMore={props.loadingMore}
      onLoadMore={props.onLoadMore}
    />
  );
}
