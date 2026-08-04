'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Radio as Primitive } from '@base-ui/react/radio'
import { RadioGroup as PrimitiveGroup } from '@base-ui/react/radio-group'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'
import type { SlotColor } from '../utils/slot.ts'
import { Typography, type TypographyVariant } from '../typography/index.ts'

/**
 * Radio — Base UI `Radio` skinned with quanta tokens, derived 1:1 from Checkbox
 * (same colour / size scale, states, focus ring and label sub-component). It is
 * circular with a centred dot indicator instead of a square with a check, and
 * has no indeterminate state. Always render Radios inside a `RadioGroup`, which
 * owns the selected `value`.
 *
 *   <RadioGroup defaultValue="a">
 *     <RadioLabel value="a" label="Option A" />
 *     <RadioLabel value="b" label="Option B" />
 *   </RadioGroup>
 */

export type RadioSize = 'sm' | 'md' | 'lg'
export type RadioColor = SlotColor | 'white'
export type RadioLabelDirection = 'left' | 'right'
export type RadioLabelSize = 'sm' | 'md'

export interface RadioOptions {
  color?: RadioColor
  size?: RadioSize
}

const COLOR_CLASS = {
  brand: 'q-radio-brand',
  white: 'q-radio-white',
  neutral: 'q-radio-neutral',
  success: 'q-radio-success',
  error: 'q-radio-error',
  warning: 'q-radio-warning',
  info: 'q-radio-info',
} satisfies Record<RadioColor, string>

const SIZE_CLASS = {
  sm: 'q-radio-sm',
  md: 'q-radio-md',
  lg: 'q-radio-lg',
} satisfies Record<RadioSize, string>

const LABEL_DIRECTION_CLASS = {
  left: 'q-radio-label-left',
  right: 'q-radio-label-right',
} satisfies Record<RadioLabelDirection, string>

const LABEL_SIZE_CLASS = {
  sm: 'q-radio-label-sm',
  md: 'q-radio-label-md',
} satisfies Record<RadioLabelSize, string>

// Title composite per label size (mirrors the old q-radio-label-{sm,md} @apply
// rules in radio.css, now applied by <Typography>).
const LABEL_TITLE_VARIANT = {
  sm: 'label-sm-medium',
  md: 'label-md-medium',
} satisfies Record<RadioLabelSize, TypographyVariant>

export function radio(options: RadioOptions = {}, ...extra: ClassValue[]): string {
  const { color = 'brand', size = 'md' } = options
  return cx('q-radio', COLOR_CLASS[color], SIZE_CLASS[size], ...extra)
}

/** Groups Radios and owns the selected `value` (controlled or `defaultValue`). */
export type RadioGroupProps = ComponentProps<typeof PrimitiveGroup>

export function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <PrimitiveGroup
      className={state => cx('q-radio-group', typeof className === 'function' ? className(state) : className)}
      {...props}
    />
  )
}

export type RadioProps = ComponentProps<typeof Primitive.Root> & RadioOptions

export function Radio({ color, size, className, ...props }: RadioProps) {
  return (
    <Primitive.Root
      className={state =>
        radio(
          { color, size },
          typeof className === 'function' ? className(state) : className,
        )}
      {...props}
    >
      <span className="q-radio-box">
        {/* keepMounted so the dot can transition in AND out (scale + fade). */}
        <Primitive.Indicator keepMounted className="q-radio-indicator">
          <span className="q-radio-dot" />
        </Primitive.Indicator>
      </span>
    </Primitive.Root>
  )
}

export interface RadioLabelProps extends Omit<ComponentProps<'label'>, 'color'> {
  /** The radio's value within the group (required). */
  value: RadioProps['value']
  label?: ReactNode
  description?: ReactNode
  direction?: RadioLabelDirection
  size?: RadioLabelSize
  color?: RadioColor
  radioSize?: RadioSize
  radioProps?: Omit<RadioProps, 'color' | 'size' | 'value'>
}

export function RadioLabel({
  value,
  label = 'Label',
  description,
  direction = 'left',
  size = 'sm',
  color,
  radioSize = size === 'md' ? 'md' : 'sm',
  radioProps,
  className,
  children,
  ...props
}: RadioLabelProps) {
  const radioNode = (
    <Radio
      value={value}
      color={color}
      size={radioSize}
      {...radioProps}
    />
  )
  const textNode = (
    <span className="q-radio-label-text">
      <Typography
        as="span"
        variant={LABEL_TITLE_VARIANT[size]}
        color="primary"
        className="q-radio-label-title"
      >
        {children ?? label}
      </Typography>
      {description
        ? (
            <Typography
              as="span"
              variant="label-sm-regular"
              color="tertiary"
              className="q-radio-label-description"
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
        'q-radio-label',
        LABEL_DIRECTION_CLASS[direction],
        LABEL_SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {direction === 'left' ? radioNode : textNode}
      {direction === 'left' ? textNode : radioNode}
    </label>
  )
}
