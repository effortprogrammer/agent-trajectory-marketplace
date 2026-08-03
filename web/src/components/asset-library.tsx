import type { ChangeEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaRef } from "@higgsfield/fnf/media";
import { AtSign as IconAtOutlined } from "lucide-react";
import { Search as IconMagnifyingGlassOutlined } from "lucide-react";
import { Plus as IconPlusMediumOutlined } from "lucide-react";
import { Avatar } from "@higgsfield/quanta/avatar";
import type { AvatarColor } from "@higgsfield/quanta/avatar";
import { Button } from "@higgsfield/quanta/button";
import { VirtualGrid } from "@higgsfield/quanta/grid";
import { Icon } from "@higgsfield/quanta/icon";
import { Input } from "@higgsfield/quanta/input";
import { Loader } from "@higgsfield/quanta/loader";
import { Media } from "@higgsfield/quanta/media";
import { Modal } from "@higgsfield/quanta/modal";
import { Tabs } from "@higgsfield/quanta/tabs";
import { Typography } from "@higgsfield/quanta/typography";

/**
 * Asset Library modal — Figma SC App Builder "Share Modal" (node 2125:15262).
 * THE app-wide asset picker: EVERY "+" / upload / attach / add-media action in
 * every app opens this modal (never a custom picker). A glass modal with a tab
 * menu header (Uploads / Image Generations / …), a segmented "All | Personal"
 * toolbar with Search, and a 5-col element grid (Upload tile + media cards).
 * Quanta components + tokens only.
 *
 * ── WIRING REQUIRED — do not ship this component unwired ────────────────────
 * The modal's INTERACTIONS all work out of the box (tab/scope filtering,
 * search, upload flow with busy/error states, select-and-close), but a REAL
 * app must wire its data props:
 *
 *   1. `items`   — the library content. Load it from the app's own data:
 *                  the user's uploads (your D1/R2 records) and their
 *                  generations (the fnf feed — `jobsFeedQueryOptions` +
 *                  `selectGenerationMedia`), mapped to `AssetLibraryItem`s
 *                  with the right `kind` ("upload" | "image" | "video").
 *                  Without it the grid shows the demo placeholder set below.
 *   2. `onUpload` — the real upload path: receive the picked `File`, POST it
 *                  as multipart `FormData` to an app-local route that calls
 *                  `media.upload(...)` server-side, and resolve the
 *                  submit-ready item (`{ name, type, src, ref }` — `ref` is
 *                  the fnf MediaRef id / durable URL). Without it the Upload
 *                  tile falls back to a browser-local object URL preview
 *                  whose `ref` is undefined and which CANNOT be sent to
 *                  generation (blob: URLs never leave the browser).
 *
 *   3. `pagination` — independent cursor/loading/error state for uploads,
 *                  image generations, and video generations.
 *
 * Generation code must always submit `item.ref` — never `item.src`. Treat a
 * selection without `ref` as preview-only.
 *
 *   <AssetLibraryModal
 *     items={libraryItems}
 *     onUpload={async file => uploadToMediaRoute(file)}
 *     onSelect={item => setImage(item)}
 *     trigger={<Dropzone render={<button type="button" />} … />}
 *   />
 *
 * IMPORTANT: `trigger` is rendered AS the modal trigger (Base UI `render`
 * prop), so the element MUST spread incoming props (`onClick`, `ref`, aria)
 * onto a real DOM node — Quanta components and `@/components/*` all do. A
 * custom component that drops unknown props will silently not open the modal;
 * wrap it in a plain `<button type="button">` if needed. See
 * `@/components/AGENTS.md` for the full wiring contract.
 */

/** A picked library element, reported by `AssetLibraryModal.onSelect`. */
export interface AssetSelection {
  name: string;
  type: string;
  /** Preview/display URL. May be a browser-local `blob:` object URL when the
   * unwired upload fallback produced it — never submit `src` to generation. */
  src: string;
  /** The submit-ready reference (fnf MediaRef id / durable URL). This — and
   * ONLY this — is what generation submits use. Absent on preview-only items
   * from the unwired upload fallback. */
  ref?: MediaRef;
  /** Media presentation used by previews after selection. */
  kind?: "upload" | "image" | "video";
}

/** A library entry: a selection plus the metadata the modal filters on. */
export interface AssetLibraryItem extends AssetSelection {
  /** Shown under the "Personal" scope (the user's own items). Default: true. */
  personal?: boolean;
  /** Shown under the "Liked" tab. */
  liked?: boolean;
  badge?: string;
  badgeColor?: AvatarColor;
}

export type AssetLibraryTab = "uploads" | "image" | "video" | "liked";

export interface AssetLibraryPaginationPage {
  hasMore: boolean;
  loading: boolean;
  error?: string;
  onLoadMore: () => Promise<unknown>;
}

export type AssetLibraryPagination = Partial<Record<AssetLibraryTab, AssetLibraryPaginationPage>>;

// PLACEHOLDER ASSETS — template demo art (see /presets/*.png), rendered ONLY
// when no `items` prop is passed so the shipped layouts have something to
// show. When adapting this template into a real app, pass `items` wired to
// the app's own data (see WIRING REQUIRED above) — do not ship the demo set.
// Grep "PLACEHOLDER ASSETS" to find every site.
const THUMBS = [
  "/presets/how-product-works.png",
  "/presets/explain.png",
  "/presets/hyper-motion.png",
  "/presets/cover.png",
];

// PLACEHOLDER ASSETS — demo data; replace when adapting (see note above).
const DEMO_ITEMS: AssetLibraryItem[] = [
  {
    name: "@Ultraviolet",
    type: "Location",
    src: THUMBS[0],
    kind: "upload",
    badge: "T",
    badgeColor: "pink",
  },
  {
    name: "@Ultraviolet",
    type: "Character",
    src: THUMBS[1],
    kind: "upload",
    liked: true,
    badge: "C",
    badgeColor: "mint",
  },
  { name: "@Ultraviolet", type: "Location", src: THUMBS[2], kind: "image" },
  { name: "@Ultraviolet", type: "Location", src: THUMBS[3], kind: "image", liked: true },
  {
    name: "@Ultraviolet",
    type: "Location",
    src: THUMBS[2],
    kind: "image",
    badge: "G",
    badgeColor: "mint",
  },
  {
    name: "@Ultraviolet",
    type: "Location",
    src: THUMBS[1],
    kind: "video",
    badge: "A",
    badgeColor: "blue",
  },
  { name: "@Ultraviolet", type: "Location", src: THUMBS[0], kind: "video" },
  { name: "@Ultraviolet", type: "Location", src: THUMBS[0], kind: "image", personal: false },
  { name: "@Ultraviolet", type: "Location", src: THUMBS[0], kind: "image", personal: false },
];

const HEADER_TABS = [
  { value: "uploads", label: "Uploads" },
  { value: "image", label: "Image Generations" },
  { value: "video", label: "Video Generations" },
  { value: "liked", label: "Liked" },
];

const TAB_KIND: Record<string, AssetLibraryItem["kind"]> = {
  uploads: "upload",
  image: "image",
  video: "video",
};

/* ── Toolbar ────────────────────────────────────────────────────────────────── */

function AssetToolbar({
  scope,
  onScopeChange,
  query,
  onQueryChange,
}: {
  scope: string;
  onScopeChange: (scope: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 bg-q-transparent-light-05 p-2">
      <div className="flex flex-1 items-center gap-2 px-1">
        <Tabs.Root
          variant="pill"
          value={scope}
          onValueChange={(value) => onScopeChange(String(value))}
        >
          <Tabs.List
            items={[
              { value: "all", label: "All" },
              { value: "personal", label: "Personal" },
            ]}
          />
        </Tabs.Root>
      </div>
      <div className="flex w-48 items-center">
        <Input
          aria-label="Search assets"
          placeholder="Search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          start={<Icon as={IconMagnifyingGlassOutlined} size="sm" />}
        />
      </div>
    </div>
  );
}

/* ── Grid ───────────────────────────────────────────────────────────────────── */

function UploadCard({
  accept,
  uploading,
  onFile,
}: {
  accept: string;
  uploading: boolean;
  onFile: (file: File, close: () => void) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Hidden dismiss trigger so a picked file closes the modal via the SAME
  // Base UI Close path the grid cards use (we can't click the visible tile
  // to close because the file dialog resolves asynchronously in `onChange`).
  const closeRef = useRef<HTMLButtonElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file != null) {
      onFile(file, () => closeRef.current?.click());
    }
    // Reset so picking the same file again still fires `onChange`.
    event.target.value = "";
  };

  return (
    <>
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center gap-1.5 rounded-q-400 p-1 disabled:opacity-60"
      >
        <div className="flex h-24 w-full items-center justify-center rounded-q-300 border border-q-border-subtle bg-q-transparent-light-05">
          <span className="flex size-10 items-center justify-center rounded-q-full bg-q-transparent-light-05 shadow-q-raised-sm">
            {uploading ? (
              <Loader size="sm" color="neutral" aria-label="Uploading" />
            ) : (
              <Icon as={IconPlusMediumOutlined} size="md" color="primary" />
            )}
          </span>
        </div>
        <div className="px-1 py-0.5">
          <Typography as="span" variant="caption-sm-semi-bold" color="primary">
            {uploading ? "Uploading…" : "Upload"}
          </Typography>
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />
      <Modal.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />
    </>
  );
}

function AssetLibraryEmptyState({
  accept,
  uploading,
  onFile,
}: {
  accept?: string;
  uploading?: boolean;
  onFile?: (file: File, close: () => void) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canUpload = accept != null && onFile != null;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file != null && onFile != null) {
      onFile(file, () => closeRef.current?.click());
    }
    event.target.value = "";
  };

  const content = (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <span className="relative flex size-12 items-center justify-center overflow-hidden rounded-q-300 border border-q-border-subtle bg-q-transparent-light-05 shadow-q-raised">
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-q-transparent-light-20 via-q-transparent-light-05 to-transparent mix-blend-overlay"
        />
        {uploading ? (
          <Loader size="sm" color="neutral" aria-label="Uploading" />
        ) : (
          <Icon as={IconAtOutlined} size="md" color="secondary" className="relative" />
        )}
      </span>
      <span className="flex flex-col items-center gap-1.5">
        <Typography as="span" variant="label-md-semi-bold" color="primary">
          No elements yet
        </Typography>
        <Typography
          as="span"
          variant="caption-sm-medium"
          color="secondary"
          className="max-w-[264px]"
        >
          Reuse your characters, locations, and props across every generation
        </Typography>
      </span>
    </div>
  );

  return (
    <>
      {canUpload ? (
        <button
          type="button"
          disabled={uploading}
          aria-label="Upload media"
          className="flex size-full items-center justify-center disabled:opacity-60"
          onClick={() => inputRef.current?.click()}
        >
          {content}
        </button>
      ) : (
        <div className="flex size-full items-center justify-center">{content}</div>
      )}
      {canUpload ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={handleChange}
          />
          <Modal.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />
        </>
      ) : null}
    </>
  );
}

function ElementCard({
  item,
  onSelect,
}: {
  item: AssetLibraryItem;
  onSelect?: (item: AssetSelection) => void;
}) {
  const videoSrc = item.ref?.url ?? item.src;
  const className =
    "flex h-full w-full flex-col gap-1.5 rounded-q-400 p-1 text-left transition-colors hover:bg-q-transparent-light-05";
  const children = (
    <>
      <Media ratio="auto" rounded="md" className="h-24 w-full">
        {item.kind === "video" ? (
          <Media.Video
            src={videoSrc}
            poster={videoSrc === item.src ? undefined : item.src}
            autoPlayInView
            loop
          />
        ) : (
          <Media.Image src={item.src} alt={item.name} />
        )}
        {item.badge != null ? (
          <span className="absolute bottom-1.5 left-1.5 z-10">
            <Avatar size="xxs" color={item.badgeColor} alt={item.badge} />
          </span>
        ) : null}
      </Media>
      <div className="flex flex-col gap-0.5 px-1 py-0.5">
        <Typography as="span" variant="caption-sm-semi-bold" color="primary" truncate>
          {item.name}
        </Typography>
        <Typography as="span" variant="caption-sm-regular" color="secondary" truncate>
          {item.type}
        </Typography>
      </div>
    </>
  );

  // With an `onSelect`, picking a card closes the modal and reports the choice;
  // without one it stays a passive tile (the original gallery behaviour).
  return onSelect != null ? (
    <Modal.Close
      className={className}
      onClick={() =>
        onSelect({
          name: item.name,
          type: item.type,
          src: item.kind === "video" ? videoSrc : item.src,
          ref: item.ref,
          kind: item.kind,
        })
      }
    >
      {children}
    </Modal.Close>
  ) : (
    <button type="button" className={className}>
      {children}
    </button>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────────── */

export interface AssetLibraryModalProps {
  /** The trigger element (e.g. a Composer.Action). Rendered as the Modal trigger. */
  trigger: ReactElement;
  /** Fired with the chosen element when a grid card is picked (closes the modal). */
  onSelect?: (item: AssetSelection) => void;
  /** The library content — WIRE THIS in a real app (user uploads + fnf
   * generations mapped to items). Defaults to the demo placeholder set. */
  items?: AssetLibraryItem[];
  /** Real upload path — WIRE THIS in a real app: upload the file (multipart →
   * app route → `media.upload`) and resolve the submit-ready item with `ref`.
   * Without it the tile produces a browser-local preview (`ref` undefined)
   * that cannot be used for generation. */
  onUpload?: (file: File) => Promise<AssetSelection>;
  /** Independent cursor/loading state for each backed tab. */
  pagination?: AssetLibraryPagination;
  /** File-input accept filter for the Upload tile. */
  accept?: string;
  /** Open on first mount. */
  defaultOpen?: boolean;
}

export function AssetLibraryModal({
  trigger,
  onSelect,
  items,
  onUpload,
  pagination,
  accept = "image/*",
  defaultOpen = false,
}: AssetLibraryModalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<AssetLibraryTab>("uploads");
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const loadingMoreRef = useRef<Partial<Record<AssetLibraryTab, boolean>>>({});

  const source = items ?? DEMO_ITEMS;
  const supportsLiked = items == null || source.some((item) => item.liked !== undefined);
  const headerTabs = supportsLiked
    ? HEADER_TABS
    : HEADER_TABS.filter((candidate) => candidate.value !== "liked");
  const activeTab = !supportsLiked && tab === "liked" ? "uploads" : tab;
  const page = pagination?.[activeTab];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((item) => {
      if (
        activeTab === "liked" ? item.liked !== true : (item.kind ?? "image") !== TAB_KIND[activeTab]
      ) {
        return false;
      }
      if (scope === "personal" && item.personal === false) {
        return false;
      }
      if (q !== "" && !`${item.name} ${item.type}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [source, activeTab, scope, query]);
  const canAutoPage = query.trim() === "" && scope === "all";
  const gridItems = useMemo<Array<{ type: "upload" } | { type: "asset"; item: AssetLibraryItem }>>(
    () => [
      ...(activeTab === "uploads" && visible.length > 0 ? ([{ type: "upload" }] as const) : []),
      ...visible.map((item) => ({ type: "asset" as const, item })),
    ],
    [activeTab, visible],
  );

  const requestPage = useCallback(
    (retry = false) => {
      if (
        !open ||
        page == null ||
        page.loading ||
        loadingMoreRef.current[activeTab] === true ||
        (!retry && (!page.hasMore || page.error != null))
      ) {
        return;
      }

      loadingMoreRef.current[activeTab] = true;
      void Promise.resolve(page.onLoadMore())
        .catch(() => undefined)
        .finally(() => {
          loadingMoreRef.current[activeTab] = false;
        });
    },
    [activeTab, open, page],
  );

  useEffect(() => {
    if (
      !canAutoPage ||
      gridItems.length > 0 ||
      page == null ||
      page.loading ||
      !page.hasMore ||
      page.error != null
    ) {
      return;
    }
    requestPage();
  }, [canAutoPage, gridItems.length, page, requestPage]);

  const handleFile = async (file: File, close: () => void) => {
    setUploadError(null);
    if (onUpload == null) {
      // ponytail: unwired fallback — browser-local preview only (no `ref`);
      // wire `onUpload` for a submit-ready MediaRef (see WIRING REQUIRED).
      onSelect?.({ name: file.name, type: file.type || "Upload", src: URL.createObjectURL(file) });
      close();
      return;
    }
    setUploading(true);
    try {
      const uploaded = await onUpload(file);
      onSelect?.(uploaded);
      close();
    } catch {
      setUploadError("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={setOpen}>
      <Modal.Trigger render={trigger} />
      <Modal.Content size="xl">
        <Modal.Header flush className="px-2 py-1">
          <Tabs.Root
            variant="pill"
            value={activeTab}
            onValueChange={(value) => setTab(String(value) as AssetLibraryTab)}
            className="flex-1"
          >
            <Tabs.List items={headerTabs} />
          </Tabs.Root>
          <Modal.CloseButton />
        </Modal.Header>

        <div className="flex h-[595px] flex-col gap-px overflow-clip rounded-q-400">
          <AssetToolbar
            scope={scope}
            onScopeChange={setScope}
            query={query}
            onQueryChange={setQuery}
          />
          {uploadError != null ? (
            <div className="shrink-0 bg-q-transparent-light-05 px-3 py-2">
              <Typography as="p" variant="caption-sm-regular" color="danger">
                {uploadError}
              </Typography>
            </div>
          ) : null}
          <div
            aria-busy={page?.loading === true}
            className="relative min-h-0 flex-1 bg-q-transparent-light-05"
          >
            <VirtualGrid
              key={`${activeTab}:${scope}:${query}`}
              items={gridItems}
              cols={5}
              rowHeight={148}
              gap={3}
              overscan={2}
              height="100%"
              viewportClassName="p-2"
              getKey={(entry, index) =>
                entry.type === "upload"
                  ? "upload"
                  : `${entry.item.ref?.id ?? entry.item.src}:${index}`
              }
              renderItem={(entry) =>
                entry.type === "upload" ? (
                  <UploadCard accept={accept} uploading={uploading} onFile={handleFile} />
                ) : (
                  <ElementCard item={entry.item} onSelect={onSelect} />
                )
              }
              onEndReached={canAutoPage && page?.loading !== true ? requestPage : undefined}
              endReachedThresholdPx={240}
            />
            {gridItems.length === 0 && page?.loading ? (
              <div className="absolute inset-0 flex items-center justify-center py-10">
                <Loader size="sm" color="neutral" aria-label="Loading assets" />
              </div>
            ) : gridItems.length === 0 && page?.error != null ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Typography as="p" variant="caption-sm-regular" color="danger">
                  {page.error}
                </Typography>
                <Button variant="tertiary" size="xs" onClick={() => requestPage(true)}>
                  Retry
                </Button>
              </div>
            ) : gridItems.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-2">
                <AssetLibraryEmptyState
                  accept={activeTab === "uploads" ? accept : undefined}
                  uploading={uploading}
                  onFile={activeTab === "uploads" ? handleFile : undefined}
                />
                {!canAutoPage && page?.hasMore ? (
                  <Button variant="tertiary" size="xs" onClick={() => requestPage()}>
                    {query.trim() === "" ? "Load more" : "Search more"}
                  </Button>
                ) : null}
              </div>
            ) : page?.loading ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-q-background-secondary py-3">
                <Loader size="sm" color="neutral" aria-label="Loading more assets" />
              </div>
            ) : page?.error != null ? (
              <div
                className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-q-background-secondary py-3"
                role="alert"
              >
                <Typography as="p" variant="caption-sm-regular" color="danger">
                  {page.error}
                </Typography>
                <Button variant="tertiary" size="xs" onClick={() => requestPage(true)}>
                  Retry
                </Button>
              </div>
            ) : null}
            {gridItems.length > 0 &&
            !canAutoPage &&
            page?.hasMore &&
            !page.loading &&
            page.error == null ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-q-background-secondary py-3">
                <Button variant="tertiary" size="xs" onClick={() => requestPage()}>
                  {query.trim() === "" ? "Load more" : "Search more"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
