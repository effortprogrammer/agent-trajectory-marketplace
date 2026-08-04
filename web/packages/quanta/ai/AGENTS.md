# Instructions for AI agents using `@higgsfield/quanta`

Canonical AI guide for generating code that consumes Quanta. Quanta is the
Higgsfield design system package: theme runtime, Tailwind token utilities, and
React components skinned with those tokens. Package/tool pointers should route
here first.

## TL;DR rules

1. **Import the CSS exactly once at the app root** (root CSS or root client
   entry):
   ```ts
   import '@higgsfield/quanta/theme.css'
   import '@higgsfield/quanta/primitives.css'
   import '@higgsfield/quanta/tailwind.css'
   ```
2. **Use public subpath imports only.** Example:
   `import { Button } from '@higgsfield/quanta/button'`. Never import from
   `src/components/*`.
3. **Use Quanta components before custom markup.** Button, Input, Modal,
   Dropdown, Command, Vault, Tabs, form controls, status, feedback, and display
   primitives are already available.
4. **Prefix design-semantic utilities with `q-`.** Use
   `bg-q-background-primary`, `text-q-body-md-regular`,
   `border-q-border-subtle`, `z-q-modal`.
5. **Spacing is native Tailwind scale, not old token numbers.** Use `p-4`,
   `gap-2`, `h-10`, `md:grid`. Do not use stale classes like `p-400`,
   `gap-200`, or `mt-300`.
6. **Use composite typography.** Use `text-q-headline-md-semi-bold`, not
   `text-2xl font-semibold`.
7. **Do not invent utilities or hardcode colors/sizes.** Check
   `src/css/tailwind/*.css` or ask for a token gap.
8. **Generated apps should look finished, not merely functional.** Build real
   layouts with clear hierarchy, breathing room, responsive constraints,
   empty/loading/error states, and polished control choices.

## The `q-` namespace

Quanta shares a Tailwind build with legacy Higgsfield UI packages; to avoid
collisions, design-semantic utilities are prefixed with `q-`. Rule of thumb:
color, type, z-index, border-width, and component classes use `q-`; spacing,
layout, sizing, and breakpoints use native Tailwind. Border widths:
`border-q-hairline` (0.5px), `border-q-thin`, `border-q-medium`,
`border-q-thick`.

Do not expose Quanta internals as app API. `q-button-*`, `q-menu-*`,
`q-modal-*`, and similar classes exist so Quanta components can render. App
code should use components and recipe helpers such as `button()` only when
styling a non-button trigger.

## Utility quick reference

### Color

```txt
Surface:  bg-q-background-{primary,secondary,secondary-strong,tertiary,inverse,glass,elevated-start,elevated-end}
Text:     text-q-text-{primary,secondary,tertiary,inverse,disabled,link,brand,danger,success,warning,info,on-overlay-secondary,on-overlay-tertiary}
Border:   border-q-border-{default,subtle,strong,focus,error,warning,success,inverse}
State:    bg/text/border-q-state-{error,success,warning,info}-*
Brand:    bg/text/border-q-brand-{primary,blue,cyan,green,orange,pink,red,yellow,yellow-light}
```

Prefer semantic roles. Raw palette utilities are for Quanta internals only.

### Typography

Composite typography utilities include font size, line-height, font weight,
letter spacing, and font family where needed.

```txt
Roles:    display, headline, title, body, label, caption, mono, accent
Sizes:    lg, md, sm
Weights:  black, bold, semi-bold, medium, regular
```

Families per role: `display`/`headline`/`title` render Space Grotesk (the
brand headline face), `body`/`label`/`caption` render Inter, `accent` is
Space Grotesk bold (tight tracking; pair with `uppercase` for the hero/CTA
look), `mono` is IBM Plex Mono.

### Z-index

```txt
z-q-{base,dropdown,sticky,overlay,modal,popover,toast,tooltip}   ← 8 semantic keys (0..70 in steps of 10)
```

Semantic names are the canonical choice over Tailwind's `z-N`.

### Spacing and breakpoints

Use native Tailwind spacing from the configured scale:
`0`, `0.5`, `1`, `1.5`, `2`, `2.5`, `3`, `4`, `5`, `6`, `7`, `8`, `10`,
`12`, `14`, `16`, `20`, `24`.

Examples: `p-6`, `px-4`, `gap-3`, `space-y-4`, `h-10`, `w-80`.

Breakpoints are mobile-first. Quanta ships three named variants (see
`src/css/tailwind/breakpoint.css`): `q-tablet:` (48rem), `q-desktop:` (80rem),
`q-wide:` (120rem). Tailwind's default `sm:`/`md:`/`lg:`/`xl:`/`2xl:` variants
also work. There are no `tablet:`/`desktop:`/`wide:` variants.

## Component catalog

Import every component by subpath, e.g.
`import { Modal } from '@higgsfield/quanta/modal'`.

### Actions and navigation

| Component | Import | Use |
|---|---|---|
| `Button`, `button` | `@higgsfield/quanta/button` | Primary/secondary actions, links with `as="a"`, trigger composition with `asChild` |
| `NavigationMenu` | `@higgsfield/quanta/navigation-menu` | Product nav, app top nav, grouped menus |
| `Sidebar` | `@higgsfield/quanta/sidebar` | Product navigation rail — header switcher, sections, composite `Item` rows (`ItemIcon`/`ItemLabel`/`ItemMeta`/`ItemEnd`), built-in collapse (`Toggle`) |
| `Tabs` | `@higgsfield/quanta/tabs` | View switching, segmented controls, modal header tabs |
| `Dropdown` | `@higgsfield/quanta/dropdown` | Menus, model pickers, searchable selection, submenus |
| `Command` | `@higgsfield/quanta/cmdk` | Command palette, quick switchers, keyboard-first search |
| `ButtonGroup`, `buttonGroup` | `@higgsfield/quanta/button-group` | Segmented action clusters and icon toolbars — propagates `size`/`variant`, `attached` joins, `orientation` stacks |

Button variants:

- Product actions: `primary`, `secondary`, `tertiary`, `outline`, `ghost`, `brandSoft`
  — variant colors do NOT follow the token names: `primary` = flat lime,
  `secondary` = solid white, `tertiary` = dark white/10 glass. In this
  template's apps, ordinary/navigation actions use the dark
  `tertiary`/`ghost`; generation CTAs use `marketingPrimary`
- Destructive: `danger`, `dangerSoft`
- Marketing: `marketingPrimary`, `marketingSecondary`,
  `marketingTertiary`, `marketingGhost`
- Special accents: `specialBrand`, `specialPink`

Use `iconOnly` only for true icon buttons with an accessible label.

### Forms and controls

| Component | Import | Use |
|---|---|---|
| `Input` | `@higgsfield/quanta/input` | Labelled single-line fields, helper/error text, prefix/suffix icons |
| `Textarea` | `@higgsfield/quanta/textarea` | Labelled multi-line fields, prompts, comments, notes |
| `Select` | `@higgsfield/quanta/select` | Single/multiple choice from a known option set — field-styled trigger, grouped glass popup, leading icons/badges; selected row highlights; `connected` on `Root` nests the field inside a wider popup that overlaps behind it (min-width floored) |
| `Autocomplete` | `@higgsfield/quanta/autocomplete` | Type-to-filter selection — search input + filtered glass list, rich item rows, clear affix, empty state; `connected` on `Root` nests the input inside a wider popup that overlaps behind it (input stays on top + typable) |
| `Checkbox`, `CheckboxLabel` | `@higgsfield/quanta/checkbox` | Multi-select booleans and labelled checkbox rows |
| `RadioGroup`, `Radio`, `RadioLabel` | `@higgsfield/quanta/radio` | Exclusive choices |
| `Switch` | `@higgsfield/quanta/switch` | Binary settings that apply immediately |
| `Slider` | `@higgsfield/quanta/slider` | Stepped or continuous numeric settings |
| `Toggle` | `@higgsfield/quanta/toggle` | Pressed/unpressed toolbar controls |
| `Chip` | `@higgsfield/quanta/chip` | Compact selectable/filter-like chips |

Use the dedicated control for the setting shape. Do not model binary settings
as a `Button`; use `Switch`, `Checkbox`, or `Toggle`.

### Overlays and feedback

| Component | Import | Use |
|---|---|---|
| `Modal` | `@higgsfield/quanta/modal` | Centered dialogs, confirmation, editors, complex panels |
| `Vault` | `@higgsfield/quanta/vault` | Edge-docked drawer/sheet, especially mobile or tool panels |
| `Toaster`, `toast` | `@higgsfield/quanta/sonner` | App-root toast viewport and imperative notifications |
| `Progress` | `@higgsfield/quanta/progress` | Bar, line, dots, determinate/indeterminate progress |
| `Loader` | `@higgsfield/quanta/loader` | Indeterminate spinner — dots/circle/stars/shine, slot-tinted |
| `Tooltip` | `@higgsfield/quanta/tooltip` | Hover/focus hint popup — small inverted surface, optional arrow, `Provider` shares delay |
| `CloseButton`, `closeButton` | `@higgsfield/quanta/close-button` | Round dismiss for overlays; recipe styles a framework close part |

Mount one `Toaster` near the app root before calling `toast.*`.

### Display primitives

| Component | Import | Use |
|---|---|---|
| `Avatar` | `@higgsfield/quanta/avatar` | User/workspace identity, presence |
| `Badge`, `badge` | `@higgsfield/quanta/badge` | New/pro/status marker |
| `Tag` | `@higgsfield/quanta/tag` | Removable categories or model metadata |
| `Dot` | `@higgsfield/quanta/dot` | Presence/status point |
| `Kbd`, `KbdSequence` | `@higgsfield/quanta/kbd` | Keyboard shortcuts |
| `Divider` | `@higgsfield/quanta/divider` | Structural separators |
| `NotFound` | `@higgsfield/quanta/not-found` | Empty/not-found states where available |
| `Accordion` | `@higgsfield/quanta/accordion` | Expandable content sections — single/multiple open, `list`/`separated` surface, `sm`/`md`/`lg` size (scales padding, radius, type) |
| `Icon`, `icon` | `@higgsfield/quanta/icon` | Render an icon glyph at a token `size`/`color` (`as={SomeIcon}`); `icon()` recipe styles a non-Icon element |
| `Typography`, `typography` | `@higgsfield/quanta/typography` | Semantic text as a component — `variant` (display/headline/title/body/label/caption/mono/accent + size/weight) + `color`; the component form of the `text-q-*` utilities |

### Layout and surfaces

| Component | Import | Use |
|---|---|---|
| `Grid` | `@higgsfield/quanta/grid` | Responsive grids — fixed/`auto-fit`/`auto-fill` columns, `minColWidth`, `gap`, `Grid.Item` `colSpan`/`rowSpan`; `animate` FLIP-animates reflow/reorder/filter (per-cell `flipKey`) |
| `VirtualGrid` | `@higgsfield/quanta/grid` | Windowed, data-driven grid for big feeds & galleries — `items`+`renderItem`, `overscan`, fixed `cols` or responsive `minColWidth`, uniform `rowHeight`. Pair with `Media.Video autoPlayInView`. Also exports `useInView`/`useGridVirtualizer` |
| `Media` | `@higgsfield/quanta/media` | Fixed-ratio image/video tiles — `ratio`/`fit`/`rounded`, `Overlay`/`Caption`/`Fallback` parts, `useMediaFallback` onError flow; `Media.Video autoPlayInView` plays (muted) only while on screen |
| `Glass`, `glass` | `@higgsfield/quanta/glass` | Real frosted-glass surface — backdrop blur+saturate, specular edge + top sheen; pin over colorful media |
| `Card`, `card` | `@higgsfield/quanta/card` | Glass/solid content surface — `Header`/`Body`/`Footer` parts, `surface` glass\|solid, `elevation` flat\|raised; `card()` recipe |

## Component API reference

Per-component props. **These are the props you need — do NOT open the component
`.tsx` source to re-derive them.** Only the component's OWN props are listed;
every component also forwards native element / Base UI props (`className`,
`ref`, `onClick`, `render`, controlled `value`/`open` state, etc.). Lowercase
names (`button()`, `card()`) are class-string recipe helpers for styling a
non-component element. `SlotColor` = `'brand' | 'neutral' | 'success' | 'error'
| 'warning' | 'info'`.

### Actions and navigation

**`Button`** — `@higgsfield/quanta/button`
`variant` (`'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'dangerSoft' | 'brandSoft' | 'marketingPrimary' | 'marketingSecondary' | 'marketingTertiary' | 'marketingGhost' | 'specialBrand' | 'specialPink'`; default `'primary'`); `size` (`'xxs' | 'xs' | 'sm' | 'md' | 'lg'`; default `'sm'`); `iconOnly` (bool; needs an accessible label); `start`/`end` (ReactNode slots); `as` (ElementType, e.g. `as="a"`); `asChild` (bool — merge onto single child); `children` (label). Real `<button>` gets implicit `type="button"`.

**`ButtonGroup`** — `@higgsfield/quanta/button-group`
`orientation` (`'horizontal' | 'vertical'`; default `'horizontal'`); `attached` (bool; default `true` — segmented vs spaced); `size`/`variant` (propagate to child Buttons; child's own wins).

**`Tabs`** — `@higgsfield/quanta/tabs` · Parts: `Root`/`List`/`Tab`/`Panel`
`Root`: `variant` (`'underline' | 'pill' | 'segmented' | 'soft'`; default `'underline'`), `shape` (`'rounded' | 'pill' | 'icon'`; default `'rounded'`), `surface` (`'glass' | 'flat'`; default `'glass'`), `tone` (`'default' | 'accent' | 'glass' | 'solid' | 'brandSoft' | 'brand'`), `color` (`SlotColor`; default `'brand'`), + `value`/`defaultValue`/`onValueChange`. `List`: `indicator` (bool; default `true`), `fullWidth` (bool), `items` (data-driven `TabItem[]`). `Tab`: `value`, `iconOnly`, `start`/`end`/`subtitle`.

**`Dropdown`** — `@higgsfield/quanta/dropdown` · Parts: `Root`/`Trigger`/`Content`/`Group`/`Label`/`Separator`/`Item`/`Sub`/`SubTrigger`/`SubContent` (+ Item sub-parts)
`Root`: `selectionMode` (`'single' | 'multiple'`; default `'multiple'`), `selected`/`defaultSelected` (`string[]`), `onSelected`, `openOnHover`, + `open`/`onOpenChange`. `Content`: `size` (`'compact' | 'default' | 'large'`; default `'default'`), `surface` (`'glass' | 'solid'`), `side`/`align`/`sideOffset`, `withSearch` (bool), `searchPlaceholder`, `notFound`. `Item`: `value`, `selectable`, `disabled`, `danger`, `checked`/`onCheckedChange`, `onSelect`, slots `start`/`media`/`title`/`subtitle`/`badge`/`end`, `indicator` (`'check' | 'checkbox' | 'switch'`).

**`Command`** — `@higgsfield/quanta/cmdk` · Parts: `Root`/`Dialog`/`Input`/`List`/`Empty`/`Loading`/`Group`/`Item`/`Separator`/`Shortcut`/`Body`/`Detail`/`Footer`/`Action`
`Root`: `value`/`defaultValue`/`onValueChange`, `shouldFilter` (default `true`), `filter`, `loading`, `loop` (default `true`), `label`. `Dialog`: + `open`/`defaultOpen`/`onOpenChange`, `shortcut` (e.g. `'mod+k'`), `size` (`ModalSize`; default `'md'`). `Input`: `start` (default search icon), `placeholder`. `Item`: `value`, `keywords`, `disabled`, `onSelect`, `detail`, `action`. `Group`: `heading`.

**`NavigationMenu`** — `@higgsfield/quanta/navigation-menu` · Parts: `Root`/`List`/`Item`/`Trigger`/`Content`/`Link`/`Actions`/`Action`/`Menu`/`MenuItem`… (rich mega-menu set)
`Root`: `side` (default `'bottom'`), `align` (default `'center'`), `sideOffset` (default `8`). `Trigger`/`Link`: `accent` (bool, lime), `active` (bool, sets `aria-current`). `Action`: `iconOnly`, `href`. `Menu`: `rows` (`1|2|3|4`; default `2`), `size` (`'auto'|'image'|'video'|'audio'|'plugins'`), `layout` (`'grid'|'columns'|'custom'`), `featured`.

**`Sidebar`** — `@higgsfield/quanta/sidebar` · Parts: `Root`/`Header`/`Switcher`/`Toggle`/`Body`/`Search`/`Section`/`SectionHeader`/`SectionItems`/`Item`/`ItemIcon`/`ItemLabel`/`ItemMeta`/`ItemEnd`/`Footer`/`FooterItem`…
`Root`: `collapsed`/`defaultCollapsed`/`onCollapsedChange`, `product` (`'cinema-studio' | 'marketing-studio' | 'supercomputer'`), `flush`. `Item`: slots `start`/`title`/`meta`/`end`, `size` (`'md' | 'sm'`), `variant` (`'nav' | 'project'`), `selected`, `pinned`/`onPinChange`, `action`, `href`. `Search`: `placeholder` (default `'Search'`), `icon`. Collapse self-wires via `Toggle`.

### Forms and controls

**`Input`** — `@higgsfield/quanta/input`
`label` (ReactNode); `description` (ReactNode — helper text, hidden while error shows); `error` (ReactNode — presence triggers invalid state); `invalid` (bool — force invalid); `required` (bool; appends red `*`); `start`/`end` (leading/trailing slots; deprecated aliases `prefix`/`suffix`); `controlClassName`/`inputClassName`; + native `input` props (minus `size`/`prefix`/`color`). **Note: helper/error text props are `description`/`error`, NOT `helperText`/`errorText`.** Built on Base UI `Field`.

**`Textarea`** — `@higgsfield/quanta/textarea`
Same field shape as `Input`: `label`, `description`, `error`, `invalid`, `required`, `start` (top-pinned), `end` (bottom-pinned); `rows`; + native `textarea` props. Built on Base UI `Field`.

**`Select`** — `@higgsfield/quanta/select` · Parts: `Root`/`Trigger`/`Value`/`Icon`/`Content`/`Group`/`GroupLabel`/`Separator`/`Item`/`ItemText`/`ItemIndicator`
`Root`: `connected` (bool — popup as seamless extension), + `value`/`defaultValue`/`onValueChange`/`multiple`. `Trigger`: `size` (`'sm' | 'md' | 'lg'`; default `'md'`), `invalid`. `Value`: `placeholder`. `Content`: `surface` (`'glass' | 'solid'`), `side`/`align`/`sideOffset`. `Item`: `value`, `disabled`.

**`Autocomplete`** — `@higgsfield/quanta/autocomplete` · Parts: `Root`/`Input`/`Content`/`List`/`Item`/`Group`/`Empty`/`Clear`… (type-to-filter)
`Root`: `connected`, + `value`/`defaultValue`/`onValueChange`/`items`/`filter`. `Input`: `start` (default search icon; `null` removes), `clear` (bool; default `true`), `clearLabel`. `Content`: `solid` (bool). `Item`: `value`, `disabled`.

**`Checkbox`, `CheckboxLabel`** — `@higgsfield/quanta/checkbox`
`Checkbox`: `color` (`'brand' | 'white'`; default `'brand'`), `size` (`'sm' | 'md' | 'lg'`; default `'md'`), `indeterminate`, + `checked`/`defaultChecked`/`onCheckedChange`/`disabled`. `CheckboxLabel`: `label`, `description`, `direction` (`'left' | 'right'`; default `'left'`), `size` (`'sm' | 'md'`), `checkboxProps`.

**`Radio`, `RadioGroup`, `RadioLabel`** — `@higgsfield/quanta/radio`
`Radio`: `color` (`SlotColor`; default `'brand'`), `size` (`'sm' | 'md' | 'lg'`), + `value`/`disabled`. `RadioGroup`: `value`/`defaultValue`/`onValueChange`. `RadioLabel`: `value` (required), `label`, `description`, `direction`, `size` (`'sm' | 'md'`), `radioProps`. No indeterminate state.

**`Switch`, `SwitchLabel`** — `@higgsfield/quanta/switch`
`Switch`: `color` (`SlotColor`; default `'brand'`), `size` (`'small' | 'medium' | 'default'`; default `'small'`), + `checked`/`defaultChecked`/`onCheckedChange`/`disabled`. `SwitchLabel`: `label`, `description`, `direction`, `size` (`'sm' | 'md'`), `switchProps`.

**`Slider`** — `@higgsfield/quanta/slider`
Common: `disabled`, `showTicks`, `onChange` (`(n) => void` continuous), `onChangeEnd` (on release), `value`/`defaultValue`, `aria-label`. Stepped mode (default): `mode?: 'stepped'`, `steps` (number; min 2, default 3), value is 0-indexed step. Continuous: `mode: 'continuous'` (required), `min` (default `0`), `max` (default `1`), `step` (default `0` = free), `steps` (tick marks).

**`Toggle`** — `@higgsfield/quanta/toggle`
`color` (`SlotColor`; default `'brand'`), `size` (`'sm' | 'md' | 'lg'`), `start`/`end` slots, `children` (label), + `pressed`/`defaultPressed`/`onPressedChange`.

**`Chip`** — `@higgsfield/quanta/chip`
`color` (`SlotColor`; default `'brand'`), `size` (`'xxs' | 'xs' | 'sm' | 'md'`; default `'sm'`), `selected` (bool), `start`/`end` slots, `children` (label). Renders `<button type="button" aria-pressed={selected}>`.

### Overlays and feedback

**`Modal`** — `@higgsfield/quanta/modal` · Parts: `Root`/`Trigger`/`Close`/`Content`/`Header`/`Title`/`Description`/`CloseButton`/`BackButton`/`Search`/`Body`/`Workspace`/`Footer`/`FooterActions`
`Content`: `size` (`'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'`; default `'md'`), `initialFocus`, `container`. `Header`: `flush`. `Body`/`Workspace`: `padded` (default `true`). `Footer`/`FooterActions`: `full`. `Search`: `placeholder`, `icon`. Use `Modal.Workspace` for the inset frosted pane.

**`Vault`** — `@higgsfield/quanta/vault` · Parts: `Root`/`Trigger`/`Content`/`Header`/`Body`/`Footer`/`Title`/`Close`
`Root`: `side` (`'bottom' | 'top' | 'left' | 'right'`; default `'bottom'`). `Content`: `side` (override), `handle` (bool; default `true` for bottom). `Header`: `title`, `start`/`end`, `closeButton`. `Footer`: `caption`, `actions`, `full`.

**`Toaster`, `toast`** — `@higgsfield/quanta/sonner`
`Toaster`: `position` (`'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'`; default `'bottom-right'`), `limit` (default `3`), `duration` (ms; default `5000`), `expand`. Mount one near app root. API: `toast(title, options?)`, `toast.success/error/warning/info/loading/message(...)`, `toast.dismiss(id?)`, `toast.promise(p, { loading, success, error })`. `ToastOptions`: `description`, `duration` (`0` = sticky), `icon`, `action` (`{ label, onClick }`), `id`.

**`Progress`** — `@higgsfield/quanta/progress`
`value` (omit for indeterminate), `max` (default `100`), `variant` (`'bar' | 'dots' | 'line'`; default `'bar'`), `shape` (`'linear' | 'circular'`; default `'linear'`), `steps` (default `4`), `size` (`'xxs' | 'xs' | 'sm' | 'md' | 'lg'`), `color` (`SlotColor`), `animated`, `children` (center label for circular).

**`Loader`** — `@higgsfield/quanta/loader`
`variant` (`'dots' | 'circle' | 'stars' | 'shine'`; default `'circle'`), `size` (`'xxs' | 'xs' | 'sm' | 'md' | 'lg'`), `color` (`SlotColor`), `animated`, `aria-label` (default `'Loading'`).

**`Tooltip`** — `@higgsfield/quanta/tooltip` · Parts: `Provider`/`Root`/`Trigger`/`Content`
`Root`: `delay` (ms; default `600`), `closeDelay`, `hoverable`. `Content`: `side` (default `'top'`), `align` (default `'center'`), `sideOffset` (default `6`), `arrow` (bool). Share a `Provider` for common delay.

**`CloseButton`** — `@higgsfield/quanta/close-button`
`size` (`'sm' | 'md' | 'lg' | 'xl'`; default `'md'`), `children` (override cross glyph), `aria-label` (default `'Close'`).

### Display primitives

**`Avatar`** — `@higgsfield/quanta/avatar`
`size` (`'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'`; default `'md'`), `src`, `alt` (drives initials + auto color), `fallback`, `color` (`'neutral' | 'orange' | 'mint' | 'blue' | 'pink' | 'purple' | 'brown' | 'yellow'`; auto-hashed from `alt`), `status` (`'online' | 'offline' | 'away' | 'busy'`), `badge`, `variant` (`'filled' | 'pending' | 'dashed'`).

**`Badge`** — `@higgsfield/quanta/badge`
`variant` (`'blue' | 'lime' | 'pink' | 'purple' | 'limeSubtle' | 'nBrand' | 'nBlue'`; default `'blue'`), `size` (`'xs' | 'sm'`; default `'xs'`), `text` (falls back to `children`).

**`Tag`** — `@higgsfield/quanta/tag`
`color` (`SlotColor`; default `'neutral'`), `start`/`end` slots, `onRemove` (`() => void` — renders trailing ✕), `removeLabel`. Label is `children`.

**`Dot`** — `@higgsfield/quanta/dot`
`color` (`'green' | 'yellow' | 'red' | 'grey'`; default `'green'`), `size` (`'md' | 'sm' | 'xs'`), `animation` (`'pulse' | 'glow'`), `label` (sets `role="img"`).

**`Kbd`, `KbdSequence`** — `@higgsfield/quanta/kbd`
`Kbd`: native `kbd` props (single size). `KbdSequence`: `keys` (`ReactNode[]` — strings wrap in `<Kbd>`), `separator` (default `'+'`; `null` omits).

**`Divider`** — `@higgsfield/quanta/divider`
`orientation` (`'horizontal' | 'vertical'`; default `'horizontal'`), `children` (optional inline label, horizontal only).

**`NotFound`** — `@higgsfield/quanta/not-found`
`icon`, `title`, `subtitle`, `actions`, `size` (`'sm' | 'md' | 'lg'`), `variant` (`'plain' | 'card' | 'outline'`; default `'plain'`). Use for empty states.

**`Accordion`** — `@higgsfield/quanta/accordion` · Parts: `Root`/`Item`/`Trigger`/`Panel`
`Root`: `variant` (`'list' | 'separated'`; default `'list'`), `size` (`'sm' | 'md' | 'lg'`), + `value`/`openMultiple`. `Trigger`: `start`/`end` slots (default rotating chevron), label is `children`. `Panel`: `contentClassName`.

**`Icon`** — `@higgsfield/quanta/icon`
`size` (`'xs' | 'sm' | 'md' | 'lg' | 'xl'` → 12/16/20/24/28px; default `'md'`), `color` (`'primary' | 'secondary' | 'tertiary' | 'brand' | 'accent' | 'inverse' | 'disabled' | 'error' | 'success' | 'warning' | 'info'`; omit to inherit `currentColor`), `as` (glyph component, takes precedence over `children`), `label` (sets `role="img"`). App icons import lucide by name: `import { Search } from 'lucide-react'` (typed exports).

**`Typography`** — `@higgsfield/quanta/typography`
`as` (ElementType; default `'p'`), `variant` (`TypographyVariant`; default `'body-md-regular'` — `{display|headline|title|body|label|caption|mono|accent}-{lg|md|sm}-{weight}`), `color` (same set as Icon + `link`/`brand`/`danger`/…), `truncate`. Component form of `text-q-*` utilities.

### Layout and surfaces

**`Grid`, `VirtualGrid`** — `@higgsfield/quanta/grid` · `Grid.Item` for cells
`Grid`: `cols` (`number | 'auto-fit' | 'auto-fill'`; default `1`), `minColWidth` (CSS length STRING for auto-fit/fill, e.g. `"13rem"` — never a number), `gap`/`gapX`/`gapY` (`1..24` scale), `flow` (`'row' | 'col' | 'dense'`), `align`/`justify`, `animate` (FLIP). `Grid.Item`: `colSpan`/`rowSpan`/`colStart` (`1..12`), `flipKey`. `VirtualGrid<Item>`: `items` (required), `renderItem` (required), `rowHeight` (px, required), `cols` or `minColWidth` (here a NUMBER of px, e.g. `180` — unlike `Grid.minColWidth` which is a CSS string), `gap`, `overscan` (default `3`), `getKey`, `height` (default `'32rem'`), `onEndReached` (once per item count near the viewport end), `endReachedThresholdPx` (default `400`). Pair with `Media.Video autoPlayInView`.

**`Media`** — `@higgsfield/quanta/media` · Parts: `Root`/`Image`/`Video`/`Fallback`/`Overlay`/`Caption`
`Root`: `ratio` (`'square' | 'video' | 'portrait' | 'wide' | 'auto'` or a number; default `'video'`), `rounded` (`'none' | 'sm' | 'md' | 'lg' | 'full'`; default `'md'`). `Image`: `fit` (`'cover' | 'contain'`; default `'cover'`), `alt`. `Video`: `fit`, `autoPlayInView` (bool — muted autoplay only while on screen), `inViewThreshold` (default `0.5`). `Overlay`: `placement` (`'fill' | 'top' | 'bottom' | 'center'`). Hook `useMediaFallback()` → `{ failed, onError, reset }`.

**`Glass`** — `@higgsfield/quanta/glass`
`blur` (`'sm' | 'md' | 'lg'`; default `'md'`), `elevation` (`'flat' | 'raised'`), `rounded` (`'200'…'600' | 'full'`; default `'600'`), `interactive` (bool), `tint` (`SlotColor`). Pin over colorful media.

**`Card`** — `@higgsfield/quanta/card` · Parts: `Root`/`Header`/`Title`/`Description`/`Body`/`Footer`
`Root`: `surface` (`'glass' | 'solid'`; default `'glass'`), `elevation` (`'flat' | 'raised'`). `Header`: `title`, `description`, `actions`. `Footer`: `actions`. Do not nest cards inside cards.

## Component recipes

### Modal

```tsx
<Modal.Root>
  <Modal.Trigger render={<Button variant="secondary">Open</Button>} />
  <Modal.Content size="lg">
    <Modal.Header>
      <Modal.Title>Edit settings</Modal.Title>
      <Modal.CloseButton />
    </Modal.Header>
    <Modal.Body>
      <Modal.Workspace>
        <Input label="Name" />
      </Modal.Workspace>
    </Modal.Body>
    <Modal.Footer>
      <Modal.FooterActions>
        <Button>Save</Button>
      </Modal.FooterActions>
    </Modal.Footer>
  </Modal.Content>
</Modal.Root>
```

`Modal.Header` and `Modal.Footer` are plain rows you COMPOSE — they have no
`title`/`actions` prop. Put a `Modal.Title` (+ optional `Modal.CloseButton`) in
the header and a `Modal.FooterActions` (optionally a `Modal.FooterCaption`) in
the footer. `<Modal.Header title="…" />` is NOT a heading — `title` is just the
native HTML tooltip attribute, so it type-checks but renders nothing visible.
(Unlike `Vault.Footer`/`Card.Footer`, which do take an `actions` prop — the
parts are not uniform.) Use `Modal.Workspace` for the inset frosted pane inside
modal bodies. For split layouts, place multiple workspaces inside your own
`flex` or `grid`.

### Command palette

```tsx
<Command.Dialog shortcut="mod+k" label="Command menu">
  <Command.Input placeholder="Search actions..." />
  <Command.List>
    <Command.Empty>No results.</Command.Empty>
    <Command.Group heading="Actions">
      <Command.Item
        title="New project"
        subtitle="Create a fresh workspace"
        onSelect={createProject}
      />
    </Command.Group>
  </Command.List>
</Command.Dialog>
```

Use `Command.Body`, `Command.Detail`, `Command.Footer`, and `Command.Action`
for two-pane palettes.

### Vault drawer

```tsx
<Vault.Root side="bottom">
  <Vault.Trigger render={<Button variant="secondary">Filters</Button>} />
  <Vault.Content>
    <Vault.Header title="Filters" />
    <Vault.Body>...</Vault.Body>
    <Vault.Footer actions={<Button>Apply</Button>} />
  </Vault.Content>
</Vault.Root>
```

Use `Vault` for drawers/sheets. Use `Modal` for centered dialogs.

## Premium layout rules for generated apps

1. **Start with the real app surface, not a marketing page** — if the prompt
   asks for a tool, editor, dashboard, feed, generator, or workspace, that tool
   is the first viewport.
2. **Use a stable shell:** `min-h-dvh`, optional sidebar, main work area,
   constrained scroll regions. No app header/top bar — Higgsfield chrome
   provides the global header; a page title is a heading inside the work area.
3. **Give layouts breathing room:** `p-4`–`p-8`, `gap-3`–`gap-6`, visible
   hierarchy — text hugging borders looks unfinished.
4. **Use professional type scale:** page titles `text-q-title-lg-semi-bold` or
   `text-q-headline-md-semi-bold`, body `text-q-body-md-regular`, metadata
   `text-q-caption-sm-medium`. Do not make every label the same size.
5. **Choose the correct control:** icons for icon-only actions, `Button` for
   commands, `Tabs` for modes, `Dropdown` for option sets, `Switch`/`Checkbox`
   for booleans, `Slider` for ranges, `Input` for typed values.
6. **Do not nest cards inside cards** — use full-width bands, shells, sidebars,
   workspaces, or repeated item cards.
7. **Make empty/loading/error states first-class:** `Progress`, `Tag`, `Badge`,
   `NotFound`, and clear local state surfaces rather than blank panels.
8. **Keep text inside containers:** `min-w-0`, `truncate`, responsive grids,
   fixed control dimensions where needed.
9. **Dark surfaces need contrast:** pair `bg-q-background-primary` with nested
   `bg-q-background-secondary` or component surfaces, plus subtle borders.
10. **No arbitrary brand decoration:** no gradient orbs, blur blobs, raw
    purple/blue gradients, or stock illustration unless the prompt calls
    for it.

## Component override tokens

A generated tier of GLOBAL component-dimension knobs is published on `:root` in
`src/css/components/component.css`. These are the single-value sizing defaults
a consumer would set to resize a component — NOT per-variant color/state logic,
which stays inline in each component's CSS.

| Token | Default | Resizes |
|---|---|---|
| `--q-modal-width` | `40rem` | Modal popup width |
| `--q-modal-width-{xs,sm,md,lg,xl,2xl}` | `21.8125rem`…`87rem` | Modal `size` variant widths |
| `--q-menu-min-width` | `160px` | Dropdown/menu min width |
| `--q-menu-max-width` | `400px` | Dropdown/menu max width |
| `--q-sidebar-width` | `14.9375rem` | Sidebar rail width |
| `--q-sidebar-width-collapsed` | `3.25rem` | Collapsed sidebar rail width |
| `--q-nav-col-width` | `192px` | NavigationMenu legacy column width |
| `--q-slider-width` | `11.5rem` | Slider track width |
| `--q-sonner-width` | `22.5rem` | Toast viewport width |
| `--q-vault-width` | `22rem` | Vault drawer width |
| `--q-textarea-min-height` | `10.25rem` | Textarea min height |

To resize component X, set its `--q-<comp>-<dim>` on an ancestor (or the
component instance) — the closer scope wins the cascade, and that override IS
the mechanism. Example:

```tsx
// Wider modal for one screen — no prop, no custom CSS, just override the knob.
<div style={{ '--q-modal-width': '52rem' }}>
  <Modal.Root>…</Modal.Root>
</div>
```

## When in doubt

Check the component `index.ts` exports and `src/css/tailwind/*.css` utility
names; ask for a token gap instead of inventing values.
