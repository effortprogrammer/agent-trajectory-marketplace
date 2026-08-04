"use client";

import { Children, isValidElement } from "react";
import type { ComponentProps, ComponentPropsWithRef, ReactElement, ReactNode, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { Sparkle as SparklesGlyph } from "lucide-react";
import { cn as cx } from "@/lib/utils";

/**
 * PromptBox — the Studio "prompt dock" (Figma Marketing-Studio node 7259:51362,
 * reused in the Cinema-Studio generation state 21768:60842). The horizontal
 * generation bar every Studio screen leads with: a vertical generation-MODE rail
 * (Product / App), then one shared right-side dock containing the prompt SURFACE
 * (a free-text area over a footer row of setting PILLS), a strip of reference
 * UPLOAD tiles (Product / Avatar), and the special GENERATE button.
 *
 * It is the counterpart to `Composer` (the tall side-rail prompt pane): where
 * Composer is a single vertical field, PromptBox is the wide multi-slot dock
 * that carries the mode rail, inline setting pickers, upload tiles, and the CTA.
 *
 * COMPOSITION-FIRST (same rules as Composer / Sidebar / Modal). The component
 * owns the DESIGN — the two-layer prompt surface, the pill/tile/mode shells, the
 * lime CTA — and every control is CONTENT you compose:
 *
 *   <PromptBox.Root>
 *     <PromptBox.ModeRail>
 *       <PromptBox.Mode active start={<CubeIcon />}>Product</PromptBox.Mode>
 *       <PromptBox.Mode start={<WorldIcon />}>App</PromptBox.Mode>
 *     </PromptBox.ModeRail>
 *
 *     <PromptBox.Body>
 *       <PromptBox.Field placeholder="Describe the scene you imagine…" />
 *       <PromptBox.Actions>
 *         <PromptBox.Pill iconOnly aria-label="Add" start={<PlusIcon />} />
 *         <PromptBox.Pill start={<Avatar/>} end={<ChevronIcon/>}>UGC</PromptBox.Pill>
 *         <PromptBox.Pill iconOnly aria-label="Settings" start={<SlidersIcon />} />
 *       </PromptBox.Actions>
 *     </PromptBox.Body>
 *
 *     <PromptBox.Uploads>
 *       <PromptBox.Upload label="Product" />
 *       <PromptBox.Upload label="Avatar" src={cover} />
 *     </PromptBox.Uploads>
 *
 *     <PromptBox.Generate cost={3} oldCost={12} />
 *   </PromptBox.Root>
 *
 * SETTINGS OPEN AS DROPDOWNS: a `PromptBox.Pill` is a bare `<button>` (or any
 * element via `render`), so it drops straight into a `Select`/`Dropdown` trigger
 * exactly like `SettingTrigger` — Base UI drives `data-popup-open` on the host:
 *
 *   <Select.Root defaultValue="ugc">
 *     <Select.Trigger bare render={<PromptBox.Pill start={<Avatar/>} end={<ChevronIcon/>} />}>
 *       <Select.Value />
 *     </Select.Trigger>
 *     <Select.Content size="picker">…</Select.Content>
 *   </Select.Root>
 *
 * `surface="glass"` skins the whole dock as a frosted floating bar (the
 * generation-state dock) instead of the plain, centered before-generation dock.
 *
 * EVERY SLOT IS OPTIONAL. Because the dock is composition-first, a caller shows a
 * subset simply by omitting parts — no part is required. For prop-driven UIs that
 * would rather keep the JSX and toggle a boolean, the optional parts (`ModeRail`,
 * `Mode`, `Pill`, `Uploads`, `Upload`) accept `hidden`: when `true` the part
 * unmounts (renders `null`) so the surrounding flex gaps collapse cleanly —
 * unlike the native `hidden` attribute, which would leave an empty box in flow.
 * This is how the Studio prompt box makes the Product/App toggle, the
 * Product/Avatar upload tiles, and each inline setting individually switchable.
 */

export type PromptBoxSurface = "plain" | "glass";

const SURFACE_CLASS = {
  plain: "",
  glass: "q-prompt-box-glass",
} satisfies Record<PromptBoxSurface, string>;

/* ── Root ──────────────────────────────────────────────────────────────────── */
export type PromptBoxRootProps = ComponentProps<"div"> & {
  /** Dock skin: the plain centered dock (default) or the frosted floating bar. */
  surface?: PromptBoxSurface;
};
function Root({
  surface = "plain",
  className,
  children: childrenProp,
  ...props
}: PromptBoxRootProps) {
  const children = Children.toArray(childrenProp);
  const modeRailChildren: ReactNode[] = [];
  const dockChildren: ReactNode[] = [];

  for (const child of children) {
    if (isValidElement(child) && child.type === ModeRail) {
      modeRailChildren.push(child);
    } else {
      dockChildren.push(child);
    }
  }

  return (
    <div className={cx("q-prompt-box", SURFACE_CLASS[surface], className)} {...props}>
      {modeRailChildren}
      {dockChildren.length > 0 ? (
        <div className="q-prompt-box-dock">
          <div className="q-prompt-box-dock-surface">{dockChildren}</div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Mode rail + Mode ──────────────────────────────────────────────────────── */
export type PromptBoxModeRailProps = ComponentProps<"div"> & {
  /** Unmount the whole generation-mode toggle (renders `null`). */
  hidden?: boolean;
};
function ModeRail({ hidden = false, className, ...props }: PromptBoxModeRailProps) {
  if (hidden) return null;
  return <div className={cx("q-prompt-box-mode-rail", className)} {...props} />;
}

export type PromptBoxModeProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** Highlighted (selected) mode. */
  active?: boolean;
  /** Unmount this mode option (renders `null`). */
  hidden?: boolean;
  /** Leading glyph (any node) stacked above the label. */
  start?: ReactNode;
  /** Mode label. */
  children?: ReactNode;
  /** Swap the host element (e.g. a Tabs/Toggle trigger). Defaults to a `<button>`. */
  render?: ReactElement;
};
function Mode({
  active = false,
  hidden = false,
  start,
  children,
  render,
  className,
  ref,
  ...props
}: PromptBoxModeProps) {
  const element = useRender({
    render,
    defaultTagName: "button",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx("q-prompt-box-mode", active && "q-prompt-box-mode-active", className),
      ...(render == null ? { type: "button" as const } : {}),
      ...(active ? { "aria-pressed": true } : {}),
      children: (
        <>
          {start != null ? <span className="q-prompt-box-mode-icon">{start}</span> : null}
          {children != null ? <span className="q-prompt-box-mode-label">{children}</span> : null}
        </>
      ),
      ...props,
    },
  });
  return hidden ? null : element;
}

/* ── Body (the two-layer prompt surface) ───────────────────────────────────── */
export type PromptBoxBodyProps = ComponentProps<"div"> & {
  /** Class for the inner white-5% surface that hosts the field + actions. */
  surfaceClassName?: string;
};
function Body({ className, surfaceClassName, children, ...props }: PromptBoxBodyProps) {
  return (
    <div className={cx("q-prompt-box-body", className)} {...props}>
      <div className={cx("q-prompt-box-surface", surfaceClassName)}>{children}</div>
    </div>
  );
}

/* ── Field (the borderless prompt text area) ───────────────────────────────── */
export type PromptBoxFieldProps = Omit<ComponentProps<"textarea">, "children">;
function Field({ className, rows = 1, ...props }: PromptBoxFieldProps) {
  return <textarea rows={rows} className={cx("q-prompt-box-field", className)} {...props} />;
}

/* ── Actions (the footer pill row) ─────────────────────────────────────────── */
function Actions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("q-prompt-box-actions", className)} {...props} />;
}

/* ── Pill (a setting control / dropdown trigger) ───────────────────────────── */
export type PromptBoxPillProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** Leading slot — a 16px icon or `<Avatar>`. */
  start?: ReactNode;
  /** Trailing slot — typically a chevron for dropdown pills. */
  end?: ReactNode;
  /** Pill label. Omit with `iconOnly` for a square glyph button (+ / settings). */
  children?: ReactNode;
  /** Square icon-only pill (no label). */
  iconOnly?: boolean;
  /** Unmount this setting pill (renders `null`). */
  hidden?: boolean;
  /** Swap the host (e.g. `Select.Trigger`/`Dropdown.Trigger`). Defaults to `<button>`. */
  render?: ReactElement;
};
function Pill({
  start,
  end,
  children,
  iconOnly = false,
  hidden = false,
  render,
  className,
  ref,
  ...props
}: PromptBoxPillProps) {
  const element = useRender({
    render,
    defaultTagName: "button",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx("q-prompt-box-pill", iconOnly && "q-prompt-box-pill-icon-only", className),
      ...(render == null ? { type: "button" as const } : {}),
      children: (
        <>
          {start != null ? <span className="q-prompt-box-pill-start">{start}</span> : null}
          {children != null ? <span className="q-prompt-box-pill-label">{children}</span> : null}
          {end != null ? <span className="q-prompt-box-pill-end">{end}</span> : null}
        </>
      ),
      ...props,
    },
  });
  return hidden ? null : element;
}

/* ── Uploads + Upload (reference-image tiles) ──────────────────────────────── */
export type PromptBoxUploadsProps = ComponentProps<"div"> & {
  /** Unmount the whole reference-tile strip (renders `null`). */
  hidden?: boolean;
};
function Uploads({ hidden = false, className, ...props }: PromptBoxUploadsProps) {
  if (hidden) return null;
  return <div className={cx("q-prompt-box-uploads", className)} {...props} />;
}

export type PromptBoxUploadProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** Bottom label (e.g. "Product", "Avatar", "Character"). */
  label?: ReactNode;
  /** Filled-state image — when set the tile shows the picked reference. */
  src?: string;
  /** Alt text for the filled image. */
  alt?: string;
  /** Unmount this reference tile (renders `null`). */
  hidden?: boolean;
  /** The corner glyph (default a plus). Compose a Button/Avatar for a filled slot. */
  add?: ReactNode;
  /** Extra overlay content composed inside the tile. */
  children?: ReactNode;
  /** Swap the host element. Defaults to a `<button>`. */
  render?: ReactElement;
};
function Upload({
  label,
  src,
  alt = "",
  hidden = false,
  add,
  children,
  render,
  className,
  ref,
  ...props
}: PromptBoxUploadProps) {
  const element = useRender({
    render,
    defaultTagName: "button",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx("q-prompt-box-upload", src != null && "q-prompt-box-upload-filled", className),
      ...(render == null ? { type: "button" as const } : {}),
      children: (
        <>
          {src != null ? <img className="q-prompt-box-upload-media" src={src} alt={alt} /> : null}
          <span className="q-prompt-box-upload-add">{add ?? <PlusGlyph />}</span>
          {label != null ? <span className="q-prompt-box-upload-label">{label}</span> : null}
          {children}
        </>
      ),
      ...props,
    },
  });
  return hidden ? null : element;
}

/** The small "+" corner glyph rendered inside an empty Upload tile by default. */
function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="16" height="16">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Generate (the special lime CTA) ───────────────────────────────────────── */
export type PromptBoxGenerateProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** The credit cost shown beside the icon. */
  cost?: ReactNode;
  /** A struck-through original cost (promo pricing). */
  oldCost?: ReactNode;
  /** Leading glyph (defaults to the sparkles mark). */
  start?: ReactNode;
  /** Button label (defaults to "Generate"). */
  children?: ReactNode;
  /** Swap the host element. Defaults to a `<button>`. */
  render?: ReactElement;
};
function Generate({
  cost,
  oldCost,
  start,
  children = "Generate",
  render,
  className,
  ref,
  ...props
}: PromptBoxGenerateProps) {
  const hasMeta = cost != null || oldCost != null || start != null;
  return useRender({
    render,
    defaultTagName: "button",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx("q-prompt-box-generate", className),
      ...(render == null ? { type: "button" as const } : {}),
      children: (
        <>
          <span className="q-prompt-box-generate-label">{children}</span>
          {hasMeta ? (
            <span className="q-prompt-box-generate-meta">
              {start ?? <SparklesGlyph />}
              {oldCost != null ? (
                <span className="q-prompt-box-generate-old">{oldCost}</span>
              ) : null}
              {cost != null ? <span className="q-prompt-box-generate-cost">{cost}</span> : null}
            </span>
          ) : null}
        </>
      ),
      ...props,
    },
  });
}

export const PromptBox = {
  Root,
  ModeRail,
  Mode,
  Body,
  Field,
  Actions,
  Pill,
  Uploads,
  Upload,
  Generate,
};
