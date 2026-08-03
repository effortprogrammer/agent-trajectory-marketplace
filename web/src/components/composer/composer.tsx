"use client";

import type { ComponentProps, ReactNode } from "react";
import { Field } from "@base-ui/react/field";
import { Button } from "@higgsfield/quanta/button";
import { cn as cx } from "@/lib/utils";

/**
 * Composer — the prompt-input surface of generation apps (Figma "Container"
 * node 2950:66575): one white-5% pane (radius/300) holding a caption label, a
 * borderless free-text area, and a footer action row (attach / link / model
 * pills) behind a subtle rule. It is the multi-line "what should we make?"
 * field every builder screen leads with.
 *
 * Like Input/Textarea it rides Base UI `Field` — the label is associated with
 * the control and validity states flow — but here the SURFACE IS THE FIELD:
 * the textarea paints no box of its own, the pane carries hover/focus/disabled.
 *
 *   <Composer
 *     label="What should the video explain?"
 *     placeholder="Type a topic, or attach files below"
 *     value={prompt}
 *     onChange={e => setPrompt(e.target.value)}
 *     actions={
 *       <>
 *         <Composer.Action start={<PlusIcon />}>Attach files</Composer.Action>
 *         <Composer.Action start={<LinkIcon />}>Link</Composer.Action>
 *       </>
 *     }
 *   />
 *
 * `Composer.Action` is the footer pill — a real quanta `Button` re-skinned by
 * `q-composer-action` (white-5% pill, 12px label), so focus/hover/disabled
 * behavior stays Button's. The text-area minimum height is the documented
 * `--q-composer-min-height` knob — override it on any ancestor to resize.
 */

type ComposerFieldProps = {
  /** Caption label above the text area. */
  label?: ReactNode;
  /** Footer slot (Composer.Action pills, counters, any node). */
  actions?: ReactNode;
  /** Swap the underlying control element (e.g. an auto-grow textarea). */
  render?: ComponentProps<typeof Field.Control>["render"];
  /** Class for the root pane. */
  className?: string;
  /** Class for the `<textarea>` element. */
  inputClassName?: string;
  /** Props forwarded to the Base UI `Field.Root`. */
  fieldProps?: ComponentProps<typeof Field.Root>;
};

export type ComposerProps = ComposerFieldProps &
  Omit<ComponentProps<"textarea">, "prefix" | "color" | "children">;

function Root({
  label,
  actions,
  render,
  rows,
  className,
  inputClassName,
  fieldProps,
  ...controlProps
}: ComposerProps) {
  return (
    <Field.Root className={cx("q-composer", className)} {...fieldProps}>
      <div className="q-composer-content">
        {label != null ? <Field.Label className="q-composer-label">{label}</Field.Label> : null}
        {/* `ref` rides in `...controlProps`; Base UI forwards it to the rendered
            <textarea> — the primary control node. Field.Control is input-typed;
            the cast bridges the element-type variance (Textarea precedent). */}
        <Field.Control
          render={render ?? <textarea rows={rows} />}
          className={cx("q-composer-input", inputClassName)}
          {...(controlProps as unknown as ComponentProps<typeof Field.Control>)}
        />
      </div>
      {actions != null ? <div className="q-composer-actions">{actions}</div> : null}
    </Field.Root>
  );
}

export type ComposerActionProps = Omit<ComponentProps<"button">, "color"> & {
  /** Leading slot (16px icon, any node) before the label. */
  start?: ReactNode;
  /** Trailing slot after the label. */
  end?: ReactNode;
};

/** Footer pill — a quanta Button re-skinned to the composer's white-5% pill. */
function Action({ className, ...props }: ComposerActionProps) {
  return (
    <Button variant="ghost" size="xs" className={cx("q-composer-action", className)} {...props} />
  );
}

export const Composer = Object.assign(Root, { Action });
