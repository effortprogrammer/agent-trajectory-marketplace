'use client'

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Switch as Primitive } from '@base-ui/react/switch'
import { Typography, type TypographyVariant } from '../typography/index.ts'
import { cx } from '../utils/cx.ts'
import { type SlotColor, slotStyle } from '../utils/slot.ts'

/**
 * Switch — a Base UI primitive skinned with quanta tokens.
 *
 * Base UI owns behavior + a11y (role="switch", hidden <input>, keyboard, focus,
 * form integration); quanta paints its state data-attributes (data-checked /
 * data-unchecked / data-disabled).
 */

export type SwitchSize = 'small' | 'medium' | 'default'

export type SwitchProps = Omit<ComponentProps<typeof Primitive.Root>, 'size'> & {
  /** Slot color — sets `--q-tint`; every surface derives from it. Default 'brand'. */
  color?: SlotColor
  size?: SwitchSize
}

const SIZE_CLASS = {
  small: 'q-switch-small',
  medium: 'q-switch-medium',
  default: 'q-switch-default',
} satisfies Record<SwitchSize, string>

export function Switch({ className, color = 'brand', size = 'small', style, ...props }: SwitchProps) {
  return (
    <Primitive.Root
      style={{ ...slotStyle(color), ...style } as CSSProperties}
      // className can be a string or a `(state) => string` — resolve the
      // caller's value against state before merging with our base classes.
      className={state => cx(
        'q-switch',
        SIZE_CLASS[size],
        typeof className === 'function' ? className(state) : className,
      )}
      {...props}
    >
      <Primitive.Thumb className="q-switch-thumb" />
    </Primitive.Root>
  )
}

/* ── Labelled switch — the trio composite (mirrors CheckboxLabel / RadioLabel) ── */

export type SwitchLabelDirection = 'left' | 'right'
export type SwitchLabelSize = 'sm' | 'md'

const LABEL_DIRECTION_CLASS = {
  left: 'q-switch-label-left',
  right: 'q-switch-label-right',
} satisfies Record<SwitchLabelDirection, string>

const LABEL_SIZE_CLASS = {
  sm: 'q-switch-label-sm',
  md: 'q-switch-label-md',
} satisfies Record<SwitchLabelSize, string>

// Title composite per label size — the exact variants the size utilities used to
// apply via descendant selectors (`.q-switch-label-sm .q-switch-label-title`).
const LABEL_TITLE_VARIANT = {
  sm: 'label-sm-medium',
  md: 'label-md-medium',
} satisfies Record<SwitchLabelSize, TypographyVariant>

export interface SwitchLabelProps extends Omit<ComponentProps<'label'>, 'color'> {
  /** Primary line. Any ReactNode (also overridable via `children`). */
  label?: ReactNode
  /** Secondary line under the title. Any ReactNode. */
  description?: ReactNode
  /** `left` = switch then text (default); `right` = text then switch (settings rows). */
  direction?: SwitchLabelDirection
  /** Label typography scale. Default `sm`. */
  size?: SwitchLabelSize
  /** Slot color forwarded to the Switch. */
  color?: SlotColor
  /** Switch size. Defaults from `size` (`md` → `default`, else `medium`). */
  switchSize?: SwitchSize
  /** Extra props for the underlying Switch (e.g. `checked`, `onCheckedChange`). */
  switchProps?: Omit<SwitchProps, 'color' | 'size'>
}

/**
 * SwitchLabel — a Switch paired with a title + optional description, the same
 * labelled-control composite as `CheckboxLabel` / `RadioLabel`. `label` /
 * `description` take any node; `children` overrides the title. Compose richer
 * titles (e.g. a Badge) by passing nodes to `label`.
 */
export function SwitchLabel({
  label = 'Label',
  description,
  direction = 'left',
  size = 'sm',
  color,
  switchSize = size === 'md' ? 'default' : 'medium',
  switchProps,
  className,
  children,
  ...props
}: SwitchLabelProps) {
  const switchNode = <Switch color={color} size={switchSize} {...switchProps} />
  const textNode = (
    <span className="q-switch-label-text">
      <Typography
        as="span"
        variant={LABEL_TITLE_VARIANT[size]}
        color="primary"
        className="q-switch-label-title"
      >
        {children ?? label}
      </Typography>
      {description
        ? (
            <Typography
              as="span"
              variant="label-sm-regular"
              color="tertiary"
              className="q-switch-label-description"
            >
              {description}
            </Typography>
          )
        : null}
    </span>
  )

  return (
    <label
      className={cx(
        'q-switch-label',
        LABEL_DIRECTION_CLASS[direction],
        LABEL_SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {direction === 'left' ? switchNode : textNode}
      {direction === 'left' ? textNode : switchNode}
    </label>
  )
}
