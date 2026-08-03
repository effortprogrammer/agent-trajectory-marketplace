"use client";

import type { ComponentPropsWithRef, ReactElement, ReactNode, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { ChevronRight as ChevronIcon } from "lucide-react";
import { Icon } from "@higgsfield/quanta/icon";
import { cn as cx } from "@/lib/utils";

/**
 * SettingTrigger — a compact labelled value row that OPENS a picker (Figma
 * "Selectbox" rows: node 2950:66590 "Voice / Select voice", 2950:66597
 * "Aspect Ratio / 16:9", 2950:66603 "Duration / Auto"). The staple control of
 * builder side panels: a caption label over the current value, a trailing
 * chevron, on the white-5% field surface (radius/300, subtle border).
 *
 * It is a TRIGGER, not a value editor — compose it with the overlay that picks
 * the value (Modal, Vault, Dropdown, Select) via their `render`/trigger props,
 * or handle `onClick` directly:
 *
 *   <SettingTrigger label="Voice" placeholder="Select voice" onClick={openVoices} />
 *   <SettingTrigger label="Aspect Ratio">16:9</SettingTrigger>
 *   <Modal.Trigger render={<SettingTrigger label="Duration">Auto</SettingTrigger>} />
 *
 * The canonical builder picker hosts a `Select` (see select.tsx): the row is
 * the bare trigger, `Select.Value` is the value slot, and Base UI drives the
 * open ring + placeholder tint via `data-popup-open` / `data-placeholder`:
 *
 *   <Select.Root defaultValue="16:9">
 *     <Select.Trigger bare render={<SettingTrigger label="Aspect Ratio" />}>
 *       <Select.Value placeholder="Select ratio" />
 *     </Select.Trigger>
 *     <Select.Content size="large">…</Select.Content>
 *   </Select.Root>
 *
 * `children` is the current value; when empty, `placeholder` renders in the
 * muted (secondary) tone. `start`/`end` are free slots — `end` defaults to the
 * 16px chevron-right. The host element is swappable via `render` (Base UI
 * `useRender`); the default is a real `<button type="button">`.
 */

export type SettingTriggerProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** Caption above the value. Any node. */
  label?: ReactNode;
  /** The current value. Any node. When null/undefined, `placeholder` shows. */
  children?: ReactNode;
  /** Muted text shown while there is no value. */
  placeholder?: ReactNode;
  /** Leading slot (20px icon, any node) before the label/value stack. */
  start?: ReactNode;
  /** Trailing slot — defaults to the 16px chevron-right glyph. */
  end?: ReactNode;
  /**
   * Swap the root element/component while keeping the row styling — e.g. an
   * `<a>` or a framework `<Link>`. Defaults to a `<button type="button">`.
   */
  render?: ReactElement;
};

export function SettingTrigger({
  label,
  children,
  placeholder,
  start,
  end,
  render,
  className,
  ref,
  ...props
}: SettingTriggerProps) {
  const isEmpty = children == null;
  const content = (
    <>
      {start != null ? <span className="q-setting-trigger-start">{start}</span> : null}
      <span className="q-setting-trigger-body">
        {label != null ? <span className="q-setting-trigger-label">{label}</span> : null}
        <span className={cx("q-setting-trigger-value", isEmpty && "q-setting-trigger-placeholder")}>
          {isEmpty ? placeholder : children}
        </span>
      </span>
      <span className="q-setting-trigger-end">{end ?? <Icon size="sm" as={ChevronIcon} />}</span>
    </>
  );

  // Only the default host is a real <button> and gets the implicit type;
  // a `render` element owns its own semantics.
  return useRender({
    render,
    defaultTagName: "button",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx("q-setting-trigger", className),
      ...(render == null ? { type: "button" as const } : {}),
      children: content,
      ...props,
    },
  });
}
