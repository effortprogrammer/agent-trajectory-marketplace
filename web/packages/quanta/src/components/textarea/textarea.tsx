'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Field } from '@base-ui/react/field'
import { cx } from '../utils/cx.ts'

/**
 * Textarea — a multi-line labelled field on Base UI `Field`, pixel-matched to
 * the Figma TextArea (node 2134:76). Shares the Input field scaffolding
 * (`q-field-*` in input.css): the white-5% surface (radius/300, 1.5px border →
 * lime on focus / red on error) flexes inside the 164px Figma state frame with
 * an 80px minimum, top-aligned. Provide `error` for the invalid state; `rows`
 * sets the textarea's intrinsic row count when consumers grow the field.
 *
 *   <Textarea label="Bio" placeholder="Add description" description="We'll never share it" />
 *   <Textarea label="Notes" rows={6} error="Please enter only letters" defaultValue="Mary387" />
 */

type FieldProps = {
  /** Label above the control. */
  label?: ReactNode
  /** Helper text below the control (hidden while an `error` shows). */
  description?: ReactNode
  /** Error message — its presence puts the field in the invalid (red) state. */
  error?: ReactNode
  /** Force the invalid state without a message. */
  invalid?: boolean
  /** Append a red `*` to the label. */
  required?: boolean
  /** Leading slot (20px icon, any node), pinned to the top. */
  start?: ReactNode
  /** Trailing slot (20px icon, any node), pinned to the bottom. */
  end?: ReactNode
  /** @deprecated Use `start` — kept as an alias for back-compat. */
  prefix?: ReactNode
  /** @deprecated Use `end` — kept as an alias for back-compat. */
  suffix?: ReactNode
  /** Swap the underlying control element (e.g. an auto-grow / 3rd-party textarea). */
  render?: ComponentProps<typeof Field.Control>['render']
  /** Class for the root Field wrapper. */
  className?: string
  /** Class for the control surface. */
  controlClassName?: string
  /** Class for the `<textarea>` element. */
  inputClassName?: string
  /** Props forwarded to the Base UI `Field.Root`. */
  fieldProps?: ComponentProps<typeof Field.Root>
}

export type TextareaProps = FieldProps & Omit<ComponentProps<'textarea'>, 'prefix' | 'color' | 'children'>

export function Textarea({
  label,
  description,
  error,
  invalid: invalidProp,
  required = false,
  start,
  end,
  prefix,
  suffix,
  render,
  rows,
  className,
  controlClassName,
  inputClassName,
  fieldProps,
  ...controlProps
}: TextareaProps) {
  const invalid = invalidProp ?? error != null
  // `start`/`end` are canonical; `prefix`/`suffix` are the back-compat aliases.
  const lead = start ?? prefix
  const trail = end ?? suffix

  return (
    <Field.Root className={cx('q-field q-field-multiline', className)} {...fieldProps}>
      {label != null
        ? (
            <Field.Label className={cx('q-field-label', invalid && 'q-field-label-invalid')}>
              {label}
              {required ? <span aria-hidden className="q-field-required">*</span> : null}
            </Field.Label>
          )
        : null}

      <div
        className={cx(
          'q-field-control q-field-control-multiline',
          invalid && 'q-field-control-invalid',
          controlClassName,
        )}
      >
        {lead != null ? <span className="q-field-affix">{lead}</span> : null}
        {/* `ref` rides in `...controlProps` and Base UI forwards it to the
            rendered <textarea> — the primary node — so it is never dropped.
            Field.Control is input-typed; the rendered <textarea> takes textarea
            attrs/handlers at runtime — the cast bridges the element-type variance. */}
        <Field.Control
          render={render ?? <textarea rows={rows} />}
          className={cx('q-field-input q-field-input-multiline', inputClassName)}
          aria-invalid={invalid || undefined}
          {...(controlProps as unknown as ComponentProps<typeof Field.Control>)}
        />
        {trail != null ? <span className="q-field-affix">{trail}</span> : null}
      </div>

      {invalid && error != null
        ? <Field.Error match className="q-field-error">{error}</Field.Error>
        : description != null
          ? <Field.Description className="q-field-description">{description}</Field.Description>
          : null}
    </Field.Root>
  )
}
