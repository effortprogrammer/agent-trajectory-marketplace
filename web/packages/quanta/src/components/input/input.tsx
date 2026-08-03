'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Field } from '@base-ui/react/field'
import { cx } from '../utils/cx.ts'

/**
 * Input — a single-line labelled text field on Base UI `Field` (label /
 * description / error association + validity), pixel-matched to the Figma
 * TextField (node 342:1354). One 40px filled surface (white-5%, radius 12) whose
 * 1.5px border turns lime on focus and red on error. Provide `error` for the
 * invalid state (red label + border + message). Pass `start`/`end` for
 * leading/trailing 20px icon slots. For multi-line input use `Textarea`.
 *
 *   <Input label="Email" placeholder="you@example.com" description="We'll never share it" />
 *   <Input label="Name" error="Please enter only letters" defaultValue="Mary387" />
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
  /** Leading slot (20px icon, any node) inside the control. */
  start?: ReactNode
  /** Trailing slot (20px icon, any node) inside the control. */
  end?: ReactNode
  /** @deprecated Use `start` — kept as an alias for back-compat. */
  prefix?: ReactNode
  /** @deprecated Use `end` — kept as an alias for back-compat. */
  suffix?: ReactNode
  /** Swap the underlying control element (e.g. a masked / 3rd-party input). */
  render?: ComponentProps<typeof Field.Control>['render']
  /** Class for the root Field wrapper. */
  className?: string
  /** Class for the control surface. */
  controlClassName?: string
  /** Class for the `<input>` element. */
  inputClassName?: string
  /** Props forwarded to the Base UI `Field.Root`. */
  fieldProps?: ComponentProps<typeof Field.Root>
}

export type InputProps = FieldProps & Omit<ComponentProps<'input'>, 'size' | 'prefix' | 'color' | 'children'>

export function Input({
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
  className,
  controlClassName,
  inputClassName,
  fieldProps,
  ...controlProps
}: InputProps) {
  const invalid = invalidProp ?? error != null
  // `start`/`end` are canonical; `prefix`/`suffix` are the back-compat aliases.
  const lead = start ?? prefix
  const trail = end ?? suffix

  return (
    <Field.Root className={cx('q-field', className)} {...fieldProps}>
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
          'q-field-control',
          invalid && 'q-field-control-invalid',
          controlClassName,
        )}
      >
        {lead != null ? <span className="q-field-affix">{lead}</span> : null}
        {/* `ref` rides in `...controlProps` and Base UI forwards it to the
            rendered <input> — the primary node — so it is never dropped. */}
        <Field.Control
          className={cx('q-field-input', inputClassName)}
          aria-invalid={invalid || undefined}
          render={render}
          {...controlProps}
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
