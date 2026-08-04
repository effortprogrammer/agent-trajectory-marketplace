# ATM — Agent Trajectory Marketplace — Design Brief

## Design read
For developers whose AI-agent sessions secretly contain valuable work they never monetize. Register: quiet, grounded confidence; a night world that slowly warms as the story pays off.

## Concept spine
"The page is a journey through the machine your sessions enter and come out of paid." The visitor's own scroll flies them through a miniature world whose stops match ATM's real value chain: your desk → your forgotten logs → redaction → review → the market → what buyers take → your upgraded desk. The same desk opens the film and closes it — same room, different life.

## Delivery tier
`cinema` — the animated website IS the hero mechanic. Lenis-smoothed scroll driving the film with GSAP for surrounding chrome.

## Locked palette
- ink `#0B1226` — deep night navy; page background, film sky
- paper `#EEF2FF` — warm off-white; headlines and body
- amber `#F5B544` — workspace glow (lamps, warm windows, "developer at work")
- teal `#2DD4BF` — trajectory signal; masked data, active nav, primary CTA
- indigo `#6366F1` — scene accents and data labels
- coral `#FB7185` — buyer-side rooms and the payoff highlight

Defense: the palette literally appears inside the film — navy world sky, amber lamps at the desk scenes, teal signal on trajectory crates, indigo as machined detail, coral reserved for the buyer close (scene 6) and the final CTA hover. Not a generic pastel/gradient set; the grade is written in code.

## Locked type
Headlines: a strong modern grotesk (Inter, tight tracking). Data/labels: JetBrains Mono. Body: a readable serif is rejected for a dev product — Inter text, Inter for UI.

Animation mode: animated-website — the scroll cinematic IS the Tier-1 mechanic and the user's intake choice. No autoplay loops; the visitor's scroll plays the film.

### Journey shape
`multi-leg` — Architecture B (diorama dives + aerial connectors), from the scroll-world skill the user explicitly requested. Justification: the story is genuinely 7 different places of one connected world, and the user chose this journey, camera style, and the native mobile twin chain.

### Journey (7 chapters, architecture B)
1. **the desk** — tiny studio at night, the agent typing on a glowing monitor, logs quietly stacking. Kicker: `Every session leaves a record.` Headline: "Your agent is already doing the work."
2. **the cupboard** — piles of glowing logs collecting dust in a drawer/cabinet. Kicker: `Then it vanishes.` Headline: "Every session ends in a folder you never open again."
3. **the redactor** — a small machine on the desk stamping teal masked bars over keys/tokens before a parcel leaves. Kicker: `Nothing leaves raw.` Headline: "Keys, tokens, env values — masked on your machine, before upload."
4. **the review desk** — operator desk inspecting sessions on a conveyor; a teal stamp on approved ones. Kicker: `Quality, gated by humans.` Headline: "Reviewed, normalized, approved before listing."
5. **the market hall** — isometric bazaar where AI labs browse shelves of glowing trajectory crates. Kicker: `Real work. Real repos.` Headline: "Not staged prompts. Not synthetic tasks. The real thing."
6. **the buyer view** — a coral-lit lab console showing normalized trajectories (structured rows, stack traces) going into training racks. Kicker: `What labs actually buy.` Headline: "Failure recovery. Real courses corrected. Real stacks."
7. **the upgraded desk + CTA** — the same studio, blazing: taller monitors, the lamp warmer, the calm of an unlocked Max plan. Kicker: `Your sessions pay your subscription.` Headline: "Fund your plan with work you already did." Drops into the final CTA block: "Start earning from your sessions."

### World grammar (byte-identical preamble)
"Soft matte clay diorama, isometric miniature, tilt-shift, warm hand-built modeling-clay texture, tiny rounded forms, soft contact shadows, cinematic warm light. Deep night navy sky `#0B1226`. Warm amber practical lamps `#F5B544` as the primary light. Teal signal accents `#2DD4BF` on anything tied to trajectories. Indigo detail accents `#6366F1`. No brand text, no logos, no lettering, no people — the agent/human presence is implied by furniture, screen glow, and props only. Center-safe composition: focal beat within the central third of frame."

- Perspective: consistent high isometric (locked through the film), ~45-degree elevation, unchanging lens.
- Light: amber practicals from every desk-like set; teal signal lights on trajectories/market crates; indigo for machine detailing.
- Background: every scene sits on a plain solid ink-navy ground (the page bg is the same shade so scenes read as floating islands in one sky, matched via Step 3).
- Desktop framing: 3:2 source stills rendered full-frame; desktop clips 16:9 out. Mobile framing: dedicated native 9:16 stills + chain, center-safe focal.

### Camera architecture
**Architecture B** (dive + aerial connector chain). The prompt law: each leg ends its final ~1 s in a slow steady forward drift toward the next destination, and each leg begins by continuing that same drift. Dives dive from wide into interior; connectors pull up and over the sky between scenes; every connector's endpoints are the actual rendered boundary frames of its surrounding dives (seam law from scroll-world, non-negotiable).

### Mobile framing
`mobileClip`/`mobilePoster` wired from a full native 9:16 chain — portrait starts, portrait dives + connectors, posters from the encoded portrait clips. Center-safe focal in source stills. No 16:9 centre-crop fallback shipped silently.

### Delivery budget
≤32 MiB desktop chain, ≤16 MiB mobile chain. 13 desktop + 13 mobile clips; if totals exceed, shorten connector durations by 0.5–1 s and re-encode before relaxing.

## Section plan (below the film)
1. Waitlist CTA block (the same primary CTA repeated from the film finale) — full-width, logo locker top, single email form.
2. "How the CLI works" — 3-step mono-label flow (install → agent runs → upload when you choose), 3 cards, distinct layout family from CTA.
3. "What buyers take" — 4-bullet table of trajectory value points (columns of value props) — pull-quote + grid family.
4. FAQ (5 entries) — accordion family, teal left rails.
5. Footer — ink block, mono legal, teal wordmark echo.

Eyebrow budget: 7/3 ≈ 2 site eyebrows beyond the film's 7.

## Asset plan
- Film: 26 chained clips (13 desktop + 13 mobile) as above; posters extracted per engine rule from encoded clips.
- Stills: 14 scene stills (7 3:2 desktop seeds, 7 9:16 mobile seeds) — used ONLY as video start_images and mobile posters; chapter posters always come from encoded clips.
- Branding: 1 cover scene (3:2) + 1 icon (1:1) via `generate_app_branding` + `finalize_app_branding` in the same fire-and-forget batch as the scene stills.
- No more hero imagery than the film itself.

## CTA inventory
- The only CTA is the single waitlist button, rendered three times with three interaction signatures: (a) **film-finale pill** inside scene 7 — ink-on-paper text on a teal capsule, magnet hover; (b) **sticky bottom bar** that fades up after scene 3 — a thin ink bar with the teal capsule, keyboard-focusable; (c) **below-fold CTA section** — a larger version with an input and submit. All trigger the same email-capture action. The email form is the conversion; the film's pill exists to promise continuity with the film's story (your hand stays on the mouse; the world stays on screen).

## Build economy / decision log
- User picked Architecture B + native mobile chain explicitly — that's the brief's cost lever, already locked.
- Two-sided seller journey (7 scenes) chosen over the 6-scene single-cut version.
- The waitlist and SEO are part of Growth but scoped to "full SEO tech" — no blog table; JSON-LD (Org/Service/FAQ) + sitemap + robots + OG/Twitter cards + semantic chapters.
- Signed copy rules: dry cleverness, no em-dashes, short sentences, developer-native terms. Developer-specific nouns (trajectory, eval, stack trace, agent run) are the artifacts the copy is built around.
- No Higgsfield names/logos anywhere on the site (website type).
