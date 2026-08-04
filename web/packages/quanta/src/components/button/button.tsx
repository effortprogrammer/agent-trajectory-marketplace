'use client'

import type { ComponentPropsWithRef, ElementType, ReactElement, ReactNode, Ref } from 'react'
import { createElement } from 'react'
import { useRender } from '@base-ui/react/use-render'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'

export type ButtonVariant =
  | 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'dangerSoft' | 'brandSoft'
  | 'marketingPrimary' | 'marketingSecondary' | 'marketingTertiary' | 'marketingGhost'
  | 'specialBrand' | 'specialPink'
export type ButtonSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
}

/**
 * Variant/size → literal class strings. These literals (not a `q-button-${x}`
 * template) are what Tailwind's scanner extracts from this file — see the
 * `@source "./button.tsx"` in button.css — so every utility is generated.
 * `satisfies Record<…>` makes the unions the single source of truth: adding a
 * variant or size fails to compile until its class is registered here.
 */
const VARIANT_CLASS = {
  primary: 'q-button-primary',
  secondary: 'q-button-secondary',
  tertiary: 'q-button-tertiary',
  outline: 'q-button-outline',
  ghost: 'q-button-ghost',
  danger: 'q-button-danger',
  dangerSoft: 'q-button-danger-soft',
  brandSoft: 'q-button-brand-soft',
  marketingPrimary: 'q-button-marketing-primary',
  marketingSecondary: 'q-button-marketing-secondary',
  marketingTertiary: 'q-button-marketing-tertiary',
  marketingGhost: 'q-button-marketing-ghost',
  specialBrand: 'q-button-special-brand',
  specialPink: 'q-button-special-pink',
} satisfies Record<ButtonVariant, string>

const SIZE_CLASS = {
  xxs: 'q-button-xxs',
  xs: 'q-button-xs',
  sm: 'q-button-sm',
  md: 'q-button-md',
  lg: 'q-button-lg',
} satisfies Record<ButtonSize, string>

/** Marketing primary/secondary have no xxs (start at xs); glass variants keep xxs. */
const MARKETING_NO_XXS_VARIANTS = new Set<ButtonVariant>([
  'marketingPrimary', 'marketingSecondary',
])

/** Build the button class string. Also usable to style non-button elements. */
export function button(options: ButtonOptions = {}, ...extra: ClassValue[]): string {
  const { variant = 'primary', size = 'sm', iconOnly = false } = options
  // Marketing primary/secondary have no xxs — clamp to xs (Figma set 1533:1490:
  // marketing primary/secondary cover xs/sm/md/lg; tertiary/ghost also add xxs).
  const effectiveSize: ButtonSize = size === 'xxs' && MARKETING_NO_XXS_VARIANTS.has(variant) ? 'xs' : size
  return cx(
    'q-button',
    VARIANT_CLASS[variant],
    SIZE_CLASS[effectiveSize],
    iconOnly && 'q-button-icon-only',
    ...extra,
  )
}

type ButtonProps<E extends ElementType> = ButtonOptions & {
  /** Render as a different element (e.g. `as="a"`) with button styling. */
  as?: E
  /**
   * Merge button styling onto the single child instead of rendering an element.
   * Use to compose with trigger primitives —
   * `<Tooltip.Trigger render={<Button>…</Button>} />` or
   * `<Button asChild><a href>…</a></Button>` — so there's no extra DOM node and
   * one ref reaches the child. Composes via Base UI's `useRender` (the public
   * successor to radix `Slot`). Takes precedence over `as`.
   */
  asChild?: boolean
  className?: string
  /** The label. Any node. */
  children?: ReactNode
  /**
   * Leading slot before the label — defaults to nothing; pass any node (a quanta
   * icon, `<Avatar>`, `<Dot>`, a spinner…). Gap + icon sizing come from the size.
   */
  start?: ReactNode
  /** Trailing slot after the label — any node (a `<Badge>`, chevron, kbd…). */
  end?: ReactNode
} & Omit<ComponentPropsWithRef<E>, 'as' | 'asChild' | 'className' | 'children' | 'start' | 'end' | keyof ButtonOptions>

/**
 * Button — composite + AI-friendly: every part is a replaceable node with a
 * sensible default (nothing). The label is `children`; `start` / `end` are slots
 * that take any node, so you compose OTHER quanta components into the button
 * rather than hand-rolling markup:
 *
 *   <Button>Save</Button>                                  // label only
 *   <Button start={<PlusIcon/>}>New project</Button>       // leading icon
 *   <Button end={<Badge variant="nBrand">new</Badge>}>Upgrade</Button>
 *   <Button iconOnly aria-label="Search" start={<SearchIcon/>} />
 *   <Button as="a" href="/x">Link</Button>  ·  <Button asChild><a/></Button>
 */
export function Button<E extends ElementType = 'button'>(props: ButtonProps<E>) {
  const { as, asChild, variant, size, iconOnly, className, children, start, end, ref, ...rest } = props
  const cls = button({ variant, size, iconOnly }, className)

  // Composite content: `start` / `end` slots flank the label. They're optional
  // grid columns — the size's gap + `& svg` rule space and size them — so the
  // legacy icon-as-children pattern (`<Button><Icon/>Label</Button>`) is
  // unchanged when no slot is passed. Not applicable under `asChild` (the child
  // owns its own content).
  const hasSlots = start != null || end != null
  const hasLabelFrame = hasSlots && !iconOnly && children != null
  const content = hasSlots
    ? (
        <>
          {start}
          {hasLabelFrame ? <span className="q-button-label-frame">{children}</span> : children}
          {end}
        </>
      )
    : children

  // asChild → merge styling onto the caller's single child element.
  // as="x"  → render that element/tag.
  // default → a real <button> (gets implicit type="button" via defaultTagName).
  const render = asChild
    ? (children as ReactElement)
    : as
      ? createElement(as)
      : undefined

  // Only a real <button> gets the implicit type; `as="a"` / asChild must not.
  const isNativeButton = !asChild && (as === undefined || as === 'button')

  // useRender is called unconditionally (rules of hooks). It merges our props
  // with the render element's: className strings join, other props overwrite.
  return useRender({
    render,
    defaultTagName: 'button',
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cls,
      ...(isNativeButton ? { type: 'button' as const } : {}),
      // When asChild, the child supplies its own children; don't override them.
      ...(asChild ? {} : { children: content }),
      ...rest,
    },
  })
}
