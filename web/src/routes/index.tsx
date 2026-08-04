import { createFileRoute } from "@tanstack/react-router";
import Lenis from "lenis";
import { useEffect, useRef, useState } from "react";

import { ScrollScrub } from "@/components/scroll-scrub/scroll-scrub";
import {
  scrollScrubConnectors,
  scrollScrubScenes,
  scrollScrubTheme,
} from "@/scroll-scrub-scenes";
import { joinWaitlist } from "@/lib/api/waitlist.functions";
import { faqJsonLd, orgJsonLd, productJsonLd, websiteJsonLd } from "@/lib/atm-seo";

export const Route = createFileRoute("/")({
  head: () => ({
    scripts: [
      { type: "application/ld+json", children: JSON.stringify(orgJsonLd()) },
      { type: "application/ld+json", children: JSON.stringify(websiteJsonLd()) },
      { type: "application/ld+json", children: JSON.stringify(productJsonLd()) },
      { type: "application/ld+json", children: JSON.stringify(faqJsonLd()) },
    ],
  }),
  component: Index,
});

const STEPS = [
  {
    n: "01",
    title: "Install",
    code: "npm i -g atm",
    body: "One command. The CLI runs alongside whichever agent you already use — Claude Code, Codex, and the rest.",
  },
  {
    n: "02",
    title: "Agent runs",
    code: "atm watch",
    body: "Every session gets logged locally. Keys, tokens, env values are masked on your machine before anything can leave.",
  },
  {
    n: "03",
    title: "Sell when you're ready",
    code: "atm publish",
    body: "Pick which trajectories to list. Operator reviews, buyers browse, payouts land in your account.",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "What exactly am I selling?",
    a: "The detailed trajectory logs your coding agent leaves behind: what it read, what it tried, where it failed, how it recovered. Not your repository source code, and never your credentials.",
  },
  {
    q: "How is privacy handled?",
    a: "Everything runs locally. Keys, tokens, env values are masked on your machine with deterministic redaction before any byte leaves your disk. Nothing uploads until you say so, and every upload is additionally reviewed by an operator before listing.",
  },
  {
    q: "Why do buyers want these instead of synthetic data?",
    a: "Real repositories carry real decisions, real failure shapes, real recovery moves. The edge cases buyers pay for are exactly the ones you hit without noticing.",
  },
  {
    q: "How do I get paid?",
    a: "Payouts go to the method you register at onboarding — credits or fiat. We publish weekly reports on what sold, at what price, and to which use-case categories.",
  },
  {
    q: "Do I need a specific agent?",
    a: "Claude Code, Codex, and the other major coding agents are supported. If your agent emits logs we can ingest, we can normalize them.",
  },
  {
    q: "Can I withdraw a session after listing it?",
    a: "Yes. You own the original data; a listed session is a licensed snapshot. Delist anytime from the dashboard. Buyers keep copies already downloaded under marketplace terms.",
  },
] as const;

function Index() {
  useSmoothScroll();
  return (
    <div className="relative min-h-dvh bg-atm-ink text-atm-paper">
      <SkipLink />
      <SiteHeader />
      <StickyWaitlistBar />
      <main id="main">
        <ScrollScrub
          connectors={scrollScrubConnectors}
          scenes={scrollScrubScenes}
          theme={scrollScrubTheme}
        />
        <BelowFold />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ---------- chrome ---------- */

function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const lenis = new Lenis({ duration: 1.1 });
    let frame = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);
}

function SkipLink() {
  return (
    <a
      href="#waitlist"
      className="sr-only atm-skip-link"
    >
      Skip to waitlist
    </a>
  );
}

function SiteHeader() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // Hide the chrome into the film's fullscreen chapter once the visitor is
        // properly mid-journey, re-appear whenever they scroll back up.
        setHidden(y > 140 && y > last);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`atm-chrome fixed inset-x-0 top-0 z-50 ${hidden ? "atm-chrome--docked-atm" : ""}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5" aria-label="ATM home">
          <span className="atm-wordmark text-sm font-bold">ATM</span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-atm-muted md:flex" aria-label="Primary">
          <a className="transition-colors hover:text-atm-paper" href="#how">
            How it works
          </a>
          <a className="transition-colors hover:text-atm-paper" href="#faq">
            FAQ
          </a>
        </nav>
        <a
          href="#waitlist"
          className="atm-btn atm-btn-primary !px-5 !py-2.5 !text-sm"
          data-source="nav"
        >
          Start earning
        </a>
      </div>
    </header>
  );
}

function StickyWaitlistBar() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const vh = window.innerHeight;
        const y = window.scrollY;
        // Reveal once the visitor is past the first three film chapters
        // (the story has earned the CTA by then) and not already at the bottom.
        const nearBottom = y + vh > document.documentElement.scrollHeight - vh * 0.9;
        setVisible(y > vh * 2.6 && !nearBottom);
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="atm-stickybar" data-visible={visible} role="complementary" aria-label="Waitlist shortcut">
      <div>
        <p className="hidden text-sm text-atm-muted sm:block">
          Sessions sell while you sleep.
        </p>
        <a href="#waitlist" className="atm-btn atm-btn-primary !py-2.5 !text-sm whitespace-nowrap">
          Start earning from your sessions
        </a>
      </div>
    </div>
  );
}

/* ---------- below-fold content ---------- */

function BelowFold() {
  return (
    <div className="relative z-10 bg-atm-ink">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <WaitlistSection />
        <HowSection />
        <FaqSection />
      </div>
    </div>
  );
}

function WaitlistSection() {
  return (
    <section id="waitlist" aria-labelledby="waitlist-title" className="py-24 sm:py-32">
      <div className="mx-auto max-w-2xl text-center">
        <p className="atm-eyebrow">Join the waitlist</p>
        <h2 id="waitlist-title" className="atm-headline mt-4 text-4xl sm:text-5xl">
          Start earning from your sessions.
        </h2>
        <p className="atm-body-lead mt-5 text-lg">
          Work you already did, monetized. We hand-match trajectories to buyers and payout in
          credits or cash — your choice at onboarding.
        </p>
        <WaitlistForm />
        <p className="mt-4 text-xs text-atm-muted">
          No posting obligations. Leave anytime.
        </p>
      </div>
    </section>
  );
}

function WaitlistForm() {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "submitting" } | { kind: "done"; already: boolean } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (new FormData(form).get("email") as string) ?? "";
    setState({ kind: "submitting" });
    try {
      const res = await joinWaitlist({ data: { email, role: "seller" } });
      if (res.ok) setState({ kind: "done", already: res.already });
      else setState({ kind: "error", message: res.error });
    } catch {
      setState({ kind: "error", message: "Network hiccup — try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <p className="mt-8 rounded-2xl border border-atm-teal/30 bg-atm-teal/10 px-5 py-4 text-sm text-atm-paper">
        {state.already
          ? "You're already on the list — we'll reach out as soon as your cohort opens."
          : "You're in. Watch your inbox — cohort invites go out in order of signup."}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3 sm:flex-row" noValidate>
      <label htmlFor="waitlist-email" className="sr-only">
        Email address
      </label>
      <input
        id="waitlist-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@dev.dev"
        className="atm-input flex-1"
        disabled={state.kind === "submitting"}
      />
      <button type="submit" className="atm-btn atm-btn-primary" disabled={state.kind === "submitting"}>
        {state.kind === "submitting" ? "Adding you…" : "Join the waitlist"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-atm-coral sm:absolute sm:mt-14">
          {state.message}
        </p>
      )}
    </form>
  );
}

function HowSection() {
  return (
    <section id="how" aria-labelledby="how-title" className="atm-hairline py-24 sm:py-28">
      <div className="mx-auto max-w-2xl">
        <p className="atm-eyebrow">How it works</p>
        <h2 id="how-title" className="atm-headline mt-4 text-3xl sm:text-4xl">
          Three commands between you and a new revenue stream.
        </h2>
      </div>
      <ol className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="atm-card atm-card-hover p-6">
            <span className="atm-kbd text-atm-teal">{s.n}</span>
            <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
            <code className="atm-wordmark mt-3 inline-block rounded px-2 py-1 text-xs text-atm-amber atm-ink-deep">
              {s.code}
            </code>
            <p className="mt-4 text-sm leading-relaxed text-atm-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="mx-auto mt-10 max-w-xl text-center text-sm text-atm-muted">
        Nothing leaves your machine until you say so. Every trajectory is masked locally,
        reviewed by an operator, then normalized before buyers ever see it.
      </p>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="atm-hairline py-24 sm:py-28">
      <div className="mx-auto max-w-2xl">
        <p className="atm-eyebrow">Questions</p>
        <h2 id="faq-title" className="atm-headline mt-4 text-3xl sm:text-4xl">
          Things developers ask before selling.
        </h2>
      </div>
      <dl className="mx-auto mt-10 max-w-3xl divide-y divide-atm-muted/15">
        {FAQ_ITEMS.map((item) => (
          <div key={item.q} className="py-5">
            <dt className="text-base font-semibold text-atm-paper">{item.q}</dt>
            <dd className="mt-2 text-sm leading-relaxed text-atm-muted">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="atm-hairline relative z-10 bg-atm-ink-deep">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block size-2 rounded-sm"
            style={{ backgroundColor: "var(--atm-teal)" }}
            aria-hidden="true"
          />
          <span className="atm-wordmark text-sm font-bold">
            ATM <span className="text-atm-muted">· trajectories</span>
          </span>
        </div>
        <p className="text-xs text-atm-muted">
          Real work. Real repos. Real payouts.
        </p>
      </div>
    </footer>
  );
}
