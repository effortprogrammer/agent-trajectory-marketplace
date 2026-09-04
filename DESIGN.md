# ATM Marketplace Design System

## 1. Atmosphere & Identity

ATM feels calm, editorial, and operationally trustworthy: a warm cream canvas,
restrained mint accents, generous whitespace, and precise mono data. Its
signature is the rounded aurora hero flowing into quiet, factual aggregate
cards. New UI must preserve that balance rather than introducing a competing
visual language.

## 2. Color

The canonical palette is the `:root` token set in `web/marketplace.css`.

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--canvas` | `#fefcf5` | Page background |
| Deep canvas | `--canvas-deep` | `#f7f7f5` | Quiet card surfaces |
| Surface | `--surface` | `#fffcf6` | Sections and controls |
| Raised surface | `--surface-raised` | `#ffffff` | Aggregate and metric cards |
| Primary text | `--text-primary` | `#3c3a39` | Headings and data |
| Secondary text | `--text-secondary` | warm 60% ink | Body copy |
| Muted text | `--text-muted` | warm 42% ink | Labels and notes |
| Border | `--border` | warm 10% ink | Card and control boundaries |
| Mint accent | `--accent` | `#81b09a` | Brand atmosphere |
| Deep mint | `--accent-deep` | `#5a7b6c` | Accessible emphasis |
| Error | `--status-error` | `#b42318` | Unavailable data |

Accent color supports identity, emphasis, focus, and meaningful status. Data
cards remain neutral unless they are the primary authenticated metric.

## 3. Typography

| Role | Token | Usage |
|---|---|---|
| Display | `--font-display`, `--type-display` | Hero statements |
| Section heading | `--font-display`, `--type-h2` | Chapter headings |
| Card heading | `--font-display`, `--type-h3` | Card and dialog titles |
| Body | `--font-body`, `--type-body` | Default copy |
| Body large | `--font-body`, `--type-body-lg` | Leads and explanations |
| Data | `--font-mono`, `--type-data` | Large numeric metrics |
| Public payout data | `--font-mono`, `--type-data-public-payout` | One-line remaining payout value |
| Labels | `--font-mono`, `--type-label` | Kicker and metadata |
| Compact data | `--font-mono`, `--type-mono-sm` | Aggregate labels and notes |

Numbers use tabular figures. Public aggregate values use compact data sizing
and must remain readable as one line at 375px.

## 4. Spacing & Layout

Spacing follows the 4px-based `--space-1` through `--space-40` scale.
`--page-gutter` and `--hero-gutter` own responsive outer spacing. Content uses
the `wide-shell` and `content-shell` primitives. Landing sections scroll with
the document; dialogs alone own internal overflow.

The public supply gate is a two-column grid at desktop and a one-column stack
at mobile. Its action column is capped at 18rem. Multiple aggregate cards stack
with `--space-4` gaps and reflow without horizontal scrolling at 375px.

## 5. Components

### Shell
- **Structure:** `wide-shell` or `content-shell` inside a semantic section.
- **States:** desktop, tablet, mobile.
- **Accessibility:** document scroll remains the owner; content never clips.

### Signal Button
- **Structure:** semantic button or anchor with `.signal-button`.
- **States:** default, hover, active, focus-visible, disabled.
- **Motion:** transform and color only, with reduced-motion fallback.

### Public Aggregate Card
- **Structure:** article with label, skeleton, strong numeric value, and note.
- **Variants:** training-token total and platform payout capacity.
- **Spacing:** `--space-2` internal gap and `--space-5` padding.
- **States:** loading skeleton, ready value, independently unavailable error.
- **Accessibility:** `role="status"`, `aria-live="polite"`, and atomic labels
  that distinguish token volume from USD payout capacity.
- **Motion:** no decorative motion; only the existing loading skeleton.
- **Layout:** vertical stack inside `.supply-locked-actions`.

### Metric Card
- **Structure:** article with label, animated value, and explanatory note.
- **Variants:** primary and supporting authenticated metrics.
- **States:** loading, ready, error.
- **Accessibility:** live-region announcement summarizes the full metric set.

### Auth Dialog
- **Structure:** native dialog, sticky console bar, body, forms, feedback.
- **States:** waitlist, signup, login, OTP verification, success, error.
- **Accessibility:** trapped focus, Escape/backdrop dismissal, focus restore.

## 6. Motion & Interaction

| Type | Token | Usage |
|---|---|---|
| Micro | `--duration-micro` | Press and feedback |
| Standard | `--duration-standard` | Buttons and controls |
| Panel | `--duration-panel` | Mobile navigation |
| Reveal | `--duration-reveal` | Section entry |
| Atmosphere | `--duration-aurora` | Hero aurora only |

Motion communicates interaction or loading. Animate only transform, opacity,
filter, or background paint. `prefers-reduced-motion` disables nonessential
motion and retains every state.

## 7. Depth & Surface

The strategy is mixed but restrained: tonal shifts establish most hierarchy,
1px warm borders define controls and cards, inset highlights make raised
surfaces legible, and prominent shadow is reserved for modal dialogs. Public
aggregate cards reuse the raised white surface and subtle inset highlight;
they do not add a new elevation level.

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- Target WCAG 2.2 AA.
- Keep visible focus on every interactive control.
- Use semantic landmarks, headings, buttons, articles, and native dialogs.
- Public live values must expose meaningful labels without depending on color.
- Preserve keyboard navigation, reduced motion, and 375px no-overflow behavior.
- Loading and failure in one public aggregate must not hide the other.

### Accepted Debt

| Item | Location | Why accepted | Exit |
|---|---|---|---|
| Legacy contextual color and geometry literals remain beside tokens | `web/marketplace.css` | Existing shipped visual system; unrelated consolidation would expand this feature | Consolidate only during an approved visual refactor |
