'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Checkbox as Primitive } from '@base-ui/react/checkbox'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'
import { Typography, type TypographyVariant } from '../typography/index.ts'

/**
 * Indicator glyphs inlined to match the Figma checkbox EXACTLY (node 481:795):
 * a chunky 2px-stroke check on a 10×8 grid with round caps/joins — distinct from
 * the package `IconCheckmark2MediumOutlined`, which is a different shape on a
 * 24×24 grid at stroke 1.5 (≈half the weight). `currentColor` inherits the
 * indicator fg (icon-inverse on the filled disk). The minus mirrors the check's
 * weight so checked/indeterminate read as one family.
 */
function CheckGlyph() {
  return (
    <svg viewBox="0 0 10 8" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 4.06L3.34 6.4L8.56 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MinusGlyph() {
  return (
    <svg viewBox="0 0 10 8" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export type CheckboxSize = 'sm' | 'md' | 'lg'
// Figma node 481:795 ships exactly two colors: brand (lime) and white.
export type CheckboxColor = 'brand' | 'white'
export type CheckboxLabelDirection = 'left' | 'right'
export type CheckboxLabelSize = 'sm' | 'md'

export interface CheckboxOptions {
  color?: CheckboxColor
  size?: CheckboxSize
}

const COLOR_CLASS = {
  brand: 'q-checkbox-brand',
  white: 'q-checkbox-white',
} satisfies Record<CheckboxColor, string>

const SIZE_CLASS = {
  sm: 'q-checkbox-sm',
  md: 'q-checkbox-md',
  lg: 'q-checkbox-lg',
} satisfies Record<CheckboxSize, string>

const LABEL_DIRECTION_CLASS = {
  left: 'q-checkbox-label-left',
  right: 'q-checkbox-label-right',
} satisfies Record<CheckboxLabelDirection, string>

const LABEL_SIZE_CLASS = {
  sm: 'q-checkbox-label-sm',
  md: 'q-checkbox-label-md',
} satisfies Record<CheckboxLabelSize, string>

// Title composite per label size (mirrors q-checkbox-label-{sm,md} in checkbox.css).
// The md case still carries a line-height override via the q-checkbox-label-title class.
const LABEL_TITLE_VARIANT = {
  sm: 'label-sm-medium',
  md: 'label-md-medium',
} satisfies Record<CheckboxLabelSize, TypographyVariant>

export function checkbox(options: CheckboxOptions = {}, ...extra: ClassValue[]): string {
  const { color = 'brand', size = 'md' } = options
  return cx('q-checkbox', COLOR_CLASS[color], SIZE_CLASS[size], ...extra)
}

export type CheckboxProps = ComponentProps<typeof Primitive.Root> & CheckboxOptions

export function Checkbox({ color, size, className, indeterminate, ...props }: CheckboxProps) {
  return (
    <Primitive.Root
      indeterminate={indeterminate}
      className={state =>
        checkbox(
          { color, size },
          typeof className === 'function' ? className(state) : className,
        )}
      {...props}
    >
      <span className="q-checkbox-box">
        <Primitive.Indicator className="q-checkbox-indicator">
          {indeterminate ? <MinusGlyph /> : <CheckGlyph />}
        </Primitive.Indicator>
      </span>
    </Primitive.Root>
  )
}

export interface CheckboxLabelProps extends Omit<ComponentProps<'label'>, 'color'> {
  label?: ReactNode
  description?: ReactNode
  direction?: CheckboxLabelDirection
  size?: CheckboxLabelSize
  color?: CheckboxColor
  checkboxSize?: CheckboxSize
  checkboxProps?: Omit<CheckboxProps, 'color' | 'size'>
}

export function CheckboxLabel({
  label = 'Label',
  description,
  direction = 'left',
  size = 'sm',
  color,
  checkboxSize = size === 'md' ? 'md' : 'sm',
  checkboxProps,
  className,
  children,
  ...props
}: CheckboxLabelProps) {
  const checkboxNode = (
    <Checkbox
      color={color}
      size={checkboxSize}
      {...checkboxProps}
    />
  )
  const textNode = (
    <span className="q-checkbox-label-text">
      <Typography
        as="span"
        variant={LABEL_TITLE_VARIANT[size]}
        color="primary"
        className="q-checkbox-label-title"
      >
        {children ?? label}
      </Typography>
      {description
        ? (
            <Typography
              as="span"
              variant="label-sm-regular"
              color="tertiary"
              className="q-checkbox-label-description"
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
        'q-checkbox-label',
        LABEL_DIRECTION_CLASS[direction],
        LABEL_SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {direction === 'left' ? checkboxNode : textNode}
      {direction === 'left' ? textNode : checkboxNode}
    </label>
  )
}
